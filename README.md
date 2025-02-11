# tw-mirror
轻量镜像站系统。

## 安装

1. 安装依赖：
```bash
npm install express axios node-cron
```

2. 创建`repos.txt`文件，每行一个需要镜像的GitHub仓库（格式：owner/repo），例如：
```
microsoft/vscode
nodejs/node
```

3. 启动服务：
```bash
node mirror-server.js
```

## API

已镜像静态文件结构：

```
./
├── <repo1>/
│   ├── 所有资源文件
│   └── manifest.json
├── <repo2>/
│   ├── ...
├── repos.txt
└── mirror-server.js
```

**manifest.json 示例：**

```json
{
  "repository": "microsoft/vscode",
  "version": "1.82.0",
  "published_at": "2023-09-07T16:36:04Z",
  "author": "vscode-bot",
  "assets": [
    {
      "name": "VSCode-win32-x64-1.82.0.zip",
      "size": 101234567,
      "download_count": 12345
    }
  ]
}
```

使用实例：

从 manifest 中获取文件名，然后：

```
https://mirror.thfls.club/hiddify/hiddify-app/Hiddify-Android-universal.apk
```
