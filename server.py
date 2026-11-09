"""Local vision-model bridge. Python 3.8+, standard library only."""
import base64
import json
import os
from pathlib import Path
import re
import secrets
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request, error
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
TOKEN = secrets.token_urlsafe(32)
MAX_BODY = 28 * 1024 * 1024
DEFAULT_PROMPT = (ROOT / '默认识别提示词.txt').read_text(encoding='utf-8')
OUTPUT_RULES = '''输出协议（必须遵守）：
只返回 JSON 对象 {"answers":[{"number":1,"answer":"A","status":"answered","note":""}]}，不要输出 JSON 以外的内容。
每项 number 必须为原始题号整数；answer 仅为一个允许的选项大写字母或 null。
status 只允许 answered、blank、multiple、uncertain。answered 的 answer 必须是单个选项字母，其他状态 answer 必须为 null。
note 只在看不清、多涂等异常时简短说明；其他情况用空字符串。不要输出推理过程。
指定范围内每个题号必须出现且只出现一次，按数字升序排列。未看到的题目记 uncertain，不能省略或猜测。
'''


def normalize(raw, start, end, choices):
    if not isinstance(raw, str):
        raise ValueError('模型未返回文本 JSON；请检查模型是否支持图片。')
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw.strip()).strip()
    try:
        obj = json.loads(text)
    except (ValueError, TypeError):
        raise ValueError('模型没有返回有效 JSON，未采用本次结果；请重试或更换视觉模型。')
    items = obj.get('answers') if isinstance(obj, dict) else None
    if not isinstance(items, list):
        raise ValueError('模型结果缺少 answers 数组。')
    rows = {n: dict(number=n, answer='?', status='uncertain', note='模型遗漏此题，待核对') for n in range(start, end + 1)}
    seen = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('模型答案条目格式无效。')
        n = item.get('number')
        if type(n) is not int or n < start or n > end or n in seen:
            raise ValueError('模型返回重复、越界或无效题号，未采用本次结果。')
        seen.add(n)
        status = item.get('status')
        answer = item.get('answer')
        note = str(item.get('note') or '')[:240]
        if status == 'answered' and isinstance(answer, str) and answer in 'ABCDE'[:choices] and len(answer) == 1:
            pass
        elif status == 'blank' and answer in (None, '', '-'):
            answer = '-'
        elif status in ('multiple', 'uncertain'):
            answer = '?'
        else:
            answer, status = '?', 'uncertain'
            note = '模型返回的选项或状态无效；' + note
        rows[n] = dict(number=n, answer=answer, status=status, note=note)
    return list(rows.values())


def recognize(body):
    start, end, choices = body.get('start'), body.get('end'), body.get('choices')
    if type(start) is not int or type(end) is not int or not 1 <= start <= end <= 300 or choices not in (4, 5):
        raise ValueError('题号范围应为 1–300，选项应为 4 或 5。')
    images = body.get('images')
    if not isinstance(images, list) or not 1 <= len(images) <= 5:
        raise ValueError('请提供 1–5 张图片。')
    for img in images:
        if not isinstance(img, str) or not img.startswith('data:image/jpeg;base64,'):
            raise ValueError('图片必须为 JPEG data URL。')
        try:
            decoded = base64.b64decode(img.split(',', 1)[1], validate=True)
        except (ValueError, TypeError):
            raise ValueError('图片编码无效。')
        if not decoded.startswith(b'\xff\xd8\xff'):
            raise ValueError('图片不是有效的 JPEG 文件。')
    custom = body.get('prompt', '')
    if not isinstance(custom, str) or len(custom) > 8000:
        raise ValueError('识别提示词应为不超过 8000 字符的文本。')
    prompt = (custom.strip() or DEFAULT_PROMPT) + '\n\n' + OUTPUT_RULES
    prompt += '\n本次只读取第 {} 至 {} 题，共 {} 题，选项为 {}。'.format(start, end, end - start + 1, 'ABCDE'[:choices])
    content = [dict(type='text', text=prompt)] + [dict(type='image_url', image_url=dict(url=img, detail='high')) for img in images]
    raw, model = provider_call(body, content)
    return dict(answers=normalize(raw, start, end, choices), model=model)


def test_connection(body):
    image, expected = body.get('image'), body.get('expected')
    if expected not in ('red', 'green', 'blue') or not isinstance(image, str) or not image.startswith('data:image/jpeg;base64,') or len(image) > 200000:
        raise ValueError('连接测试图片无效。')
    content = [dict(type='text', text='观察图片中央实心矩形的颜色。仅返回一个英文单词 red、green 或 blue，不加标点；不能看见图片则返回 unknown。'), dict(type='image_url', image_url=dict(url=image, detail='high'))]
    started = time.perf_counter()
    raw, model = provider_call(body, content)
    if not isinstance(raw, str) or raw.strip().lower() != expected:
        raise ValueError('模型接口有响应，但未正确读出测试图片颜色；请检查是否支持视觉输入。')
    return dict(ok=True, model=model, elapsedMs=round((time.perf_counter() - started) * 1000), message='图片请求与颜色测试通过；不代表答题卡识别准确率保证。')


def provider_call(body, content):
    base = str(body.get('base') or os.environ.get('VISION_BASE_URL', 'https://api.openai.com/v1')).strip().rstrip('/')
    parsed = urlparse(base)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        raise ValueError('接口地址应为不含密钥、查询参数的 API 基础地址。')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost', '::1')):
        raise ValueError('远程模型接口必须使用 HTTPS。')
    model = str(body.get('model') or os.environ.get('VISION_MODEL', '')).strip()
    key = str(body.get('key') or os.environ.get('VISION_API_KEY') or os.environ.get('OPENAI_API_KEY') or '').strip()
    if not model or not key:
        raise ValueError('请填写视觉模型名称和 API Key，或在启动前设置环境变量。')
    payload = json.dumps(dict(model=model, messages=[dict(role='user', content=content)], stream=False), ensure_ascii=False).encode('utf-8')
    req = request.Request(base + '/chat/completions', data=payload, headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    # Never follow redirects carrying a provider's Authorization header.
    class NoRedirect(request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    try:
        with request.build_opener(NoRedirect).open(req, timeout=180) as response:
            result = json.loads(response.read(4 * 1024 * 1024))
    except error.HTTPError as exc:
        hints = {400:'请求格式或图片输入不被该模型支持', 401:'API Key 无效', 403:'无权限访问此模型', 404:'接口地址或模型名称不存在', 429:'额度不足或请求过于频繁'}
        raise ValueError('模型服务返回 HTTP {}：{}。'.format(exc.code, hints.get(exc.code, '服务异常或重定向，请检查接口配置')))
    except (error.URLError, TimeoutError, OSError):
        raise ValueError('连接模型服务失败或超时，请检查网络和接口地址。')
    try:
        raw = result['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError):
        raise ValueError('接口未返回 Chat Completions 格式的内容。')
    return raw, model


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Do not log images, credentials, or requests.

    def send_json(self, code, data):
        payload = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(payload)

    def valid_host(self):
        return self.headers.get('Host') in ('127.0.0.1:8765', 'localhost:8765')

    def do_GET(self):
        if not self.valid_host():
            return self.send_json(403, dict(error='仅允许本机访问'))
        if self.path == '/api/config':
            return self.send_json(200, dict(token=TOKEN, base=os.environ.get('VISION_BASE_URL', 'https://api.openai.com/v1'), model=os.environ.get('VISION_MODEL', ''), hasKey=bool(os.environ.get('VISION_API_KEY') or os.environ.get('OPENAI_API_KEY')), prompt=DEFAULT_PROMPT))
        if self.path == '/fenbi-answer.user.js':
            payload = (ROOT / '粉笔答题卡助手.user.js').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Content-Disposition', "attachment; filename*=UTF-8''%E7%B2%89%E7%AC%94%E7%AD%94%E9%A2%98%E5%8D%A1%E5%8A%A9%E6%89%8B.user.js")
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return self.wfile.write(payload)
        if self.path not in ('/', '/index.html'):
            return self.send_json(404, dict(error='Not found'))
        payload = (ROOT / 'index.html').read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        if not self.valid_host() or self.headers.get('X-Local-Token') != TOKEN:
            return self.send_json(403, dict(error='请刷新本地网页再试'))
        origin = self.headers.get('Origin')
        if origin not in (None, 'http://127.0.0.1:8765', 'http://localhost:8765', 'https://spa.fenbi.com'):
            return self.send_json(403, dict(error='拒绝跨站请求'))
        if self.path not in ('/api/recognize', '/api/test'):
            return self.send_json(404, dict(error='Not found'))
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY:
                raise ValueError('图片请求为空或超过 28 MB，请缩小图片。')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError('请求格式无效')
            self.send_json(200, test_connection(body) if self.path == '/api/test' else recognize(body))
        except ValueError as exc:
            self.send_json(400, dict(error=str(exc)))
        except Exception:
            self.send_json(502, dict(error='模型响应异常，未修改答案；请检查接口兼容性后重试。'))


if __name__ == '__main__':
    print('Open http://127.0.0.1:8765  |  Ctrl+C to stop')
    try:
        ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
