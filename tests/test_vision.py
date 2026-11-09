import importlib.util
import json
from pathlib import Path
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request, error
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('vision', ROOT / 'server.py')
vision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vision)


class MockProvider(BaseHTTPRequestHandler):
    received = None

    def log_message(self, *args):
        pass

    def do_POST(self):
        MockProvider.received = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        if '中央实心矩形的颜色' in MockProvider.received['messages'][0]['content'][0]['text']:
            self.wfile.write(json.dumps(dict(choices=[dict(message=dict(content='red'))])).encode())
            return
        # Deliberately shuffled; blank and multiple selections must keep position.
        rows = [dict(number=4, answer=None, status='multiple'), dict(number=2, answer=None, status='blank'), dict(number=1, answer='D', status='answered')]
        self.wfile.write(json.dumps(dict(choices=[dict(message=dict(content=json.dumps(dict(answers=rows))))])).encode())


class VisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.provider = ThreadingHTTPServer(('127.0.0.1', 0), MockProvider)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), vision.Handler)
        for s in (cls.provider, cls.server):
            threading.Thread(target=s.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for s in (cls.provider, cls.server):
            s.shutdown()
            s.server_close()

    def test_shuffled_missing_blank_and_multiple(self):
        body = dict(start=1, end=4, choices=4, base='http://127.0.0.1:{}'.format(self.provider.server_port), model='test-vision', key='test-only', images=['data:image/jpeg;base64,/9j/'])
        out = vision.recognize(body)
        self.assertEqual([r['number'] for r in out['answers']], [1, 2, 3, 4])
        self.assertEqual([r['answer'] for r in out['answers']], ['D', '-', '?', '?'])
        content = MockProvider.received['messages'][0]['content']
        self.assertEqual(content[1]['image_url']['detail'], 'high')
        self.assertEqual(content[1]['image_url']['url'], body['images'][0])
        self.assertNotIn('1A2B3C4D', content[0]['text'])

    def test_custom_prompt_keeps_output_contract_and_range(self):
        body = dict(start=1, end=4, choices=4, base='http://127.0.0.1:{}'.format(self.provider.server_port), model='test-vision', key='test-only', images=['data:image/jpeg;base64,/9j/'], prompt='额外要求：注意纸张折痕。')
        vision.recognize(body)
        prompt = MockProvider.received['messages'][0]['content'][0]['text']
        self.assertIn(body['prompt'], prompt)
        self.assertIn(vision.OUTPUT_RULES, prompt)
        self.assertIn('第 1 至 4 题，共 4 题', prompt)
        body['prompt'] = '   '
        vision.recognize(body)
        self.assertIn(vision.DEFAULT_PROMPT, MockProvider.received['messages'][0]['content'][0]['text'])

    def test_duplicate_and_out_of_range_fail_closed(self):
        for rows in ([dict(number=1), dict(number=1)], [dict(number=9)], [dict(number=True)]):
            with self.assertRaises(ValueError):
                vision.normalize(json.dumps(dict(answers=rows)), 1, 4, 4)

    def test_invalid_option_and_ambiguous_status(self):
        rows = [dict(number=1, answer='AB', status='answered'), dict(number=2, answer='E', status='answered'), dict(number=3, answer='A', status='blank')]
        out = vision.normalize('```json\n' + json.dumps(dict(answers=rows)) + '\n```', 1, 3, 4)
        self.assertTrue(all(r['answer'] == '?' for r in out))
        with self.assertRaises(ValueError):
            vision.normalize('The answers are A B C D', 1, 4, 4)

    def test_unsafe_remote_endpoint_rejected(self):
        with self.assertRaisesRegex(ValueError, 'HTTPS'):
            vision.recognize(dict(start=1, end=4, choices=4, images=['data:image/jpeg;base64,/9j/'], base='http://example.com/v1', model='test', key='test'))

    def test_connection_test_requires_correct_image_reply(self):
        body = dict(base='http://127.0.0.1:{}'.format(self.provider.server_port), model='test-vision', key='test-only', image='data:image/jpeg;base64,/9j/', expected='red')
        result = vision.test_connection(body)
        self.assertTrue(result['ok'])
        self.assertEqual(result['model'], 'test-vision')
        with self.assertRaisesRegex(ValueError, '未正确读出'):
            vision.test_connection({**body, 'expected':'blue'})

    def test_http_static_config_and_post_guards(self):
        base = 'http://127.0.0.1:{}'.format(self.server.server_port)
        def req(path, data=None, extra=None):
            return request.Request(base + path, data=data, headers=dict({'Host': '127.0.0.1:8765'}, **(extra or {})))
        with request.urlopen(req('/')) as response:
            self.assertIn('text/html', response.headers['Content-Type'])
            self.assertIn(b'/api/recognize', response.read())
        with request.urlopen(req('/api/config')) as response:
            config = json.load(response)
        self.assertEqual(config['token'], vision.TOKEN)
        self.assertNotIn('key', config)
        with self.assertRaises(error.HTTPError) as result:
            request.urlopen(req('/api/recognize', b'{}'))
        self.assertEqual(result.exception.code, 403)
        with patch.object(vision, 'recognize', return_value={'answers': []}):
            with request.urlopen(req('/api/recognize', b'{}', {'X-Local-Token': config['token']})) as response:
                self.assertEqual(json.load(response)['answers'], [])
        with self.assertRaises(error.HTTPError) as result:
            request.urlopen(req('/api/recognize', b'{}', {'X-Local-Token': config['token'], 'Origin': 'https://example.com'}))
        self.assertEqual(result.exception.code, 403)


if __name__ == '__main__':
    unittest.main()
