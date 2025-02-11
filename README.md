# tw-mirror
轻量镜像站系统。

## 安装

1. 安装依赖：
```bash
npm install
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

API 基本模板：`https://mirror.thfls.club/<author>/<repo>/<filename>`

`filename` 可以从 `manifest.json` 获得。

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

**访问示例：**
```
http://localhost:3000/microsoft/vscode/
http://localhost:3000/microsoft/vscode/VSCodeSetup-x64-1.82.0.exe
```


