# 粉笔答题卡视觉识别助手

用视觉模型读取答题卡照片，并在核对后将答案逐题写入粉笔行测答题页。识别不使用 OCR，也不会自动提交答卷。

## 快速开始

1. 安装 Python 3.8+ 与 Tampermonkey。
2. 双击 `start.cmd`，它会在后台启动服务；命令行可关闭。之后打开 <http://127.0.0.1:8765/>。需要停止时双击 `stop.cmd`。
3. 在粉笔 `spa.fenbi.com/ti/exam/exercise/` 答题页中导入本仓库的 [`粉笔答题卡助手.user.js`](粉笔答题卡助手.user.js)。
4. 配置视觉模型 API。默认基础地址为 `https://api.aijws.com/v1`，模型为 `gpt-6.1-sol`。填写 API Key 后可在面板中点击“保存配置”；密钥存于 Tampermonkey 本地存储，不在仓库代码中。
5. 上传照片、裁剪答题区、选择题号范围并识别。检查结果后，确认写入；脚本不会点击“交卷”。

完整配置、识别规则、隐私和费用说明见[使用说明](使用说明.md)。

## 安全说明

- 不要把 API Key、`.env` 文件或真实答题照片提交到仓库。
- 模型识别会将裁剪后的图片发送到配置的模型服务商，并可能产生 API 费用。
- 写入会跳过空题、疑问题及冲突答案；覆盖已有答案须主动启用并二次确认。

## 开发测试

```powershell
python -m unittest discover -s tests -v
node tests/fenbi-core.test.js
node --check 粉笔答题卡助手.user.js
python -m py_compile server.py
```
