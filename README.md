# Class.typ

基于 Typst 的智慧课程。

- 左侧是目录，展示不同的章节
- 两个tab，一个是预览，一个是编辑
- 两个tab，也可以是一个是教程，一个是笔记（任何一个都可以切换preview/edit）
- 最右侧是chat，参考vscode的经验，左侧用户单击Tab中的内容，chat能看到其位置、选择内容
- 用户可切换自己的api、也可以使用server自带的
- 可调用本地软件（如Julia、R）跑一些数据分析
- 教师编辑，相关课件，可以实时显示给学生。

课件与笔记写成 `.typ`，浏览器即时编译预览；教师编辑实时同步到学生；Chat 可带选区调本机 Julia / R。

章节来自 `content/`，用户只写 Typst，不必改 TS。

```
content/
  01-引言/
    课件.typ
    笔记.typ
  02-方程/
    课件.typ
    笔记.typ
```

新建章节：加一个文件夹，放入这两个文件，刷新页面。

```bash
cd examples/browser-basic
npm install
npm start
```

打开 <http://127.0.0.1:8766>（占用时设 `TYPST_AGENT_PORT`）。教师编辑会写回上述 `.typ`；学生只读跟随。Chat 中 `/julia`、`/r` 跑本机代码。

## 课堂助手

- 模型设置支持服务商、模型及思考强度联动；快捷提示可填入修改请求。
- 请求携带当前文档与选区，不携带聊天历史。生成的源码须确认应用；章节或原文变化时阻止覆盖。
- 支持复制、失败重试、清空记录；Enter 发送，Shift + Enter 换行，中文输入确认不会误发送。
- `/julia`、`/r` 优先运行选区，否则运行命令后的代码，同时显示标准输出和错误输出。
- “停止等待”仅取消浏览器等待，不保证终止服务端任务。学生模式只读；聊天记录刷新后清空。

界面回归测试使用模拟接口，不调用模型、不写入课程文件。先用 `npm start` 启动原端口 8766，再执行：

```bash
# Playwright 已安装；不在本项目时，将 PLAYWRIGHT_MODULE 指向其 index.mjs
env -u DISPLAY node tests/chat.test.mjs
```

截图保存在 `images/`。

- <https://github.com/mitmath/computational-thinking>
