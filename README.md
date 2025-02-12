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

**访问示例：**
```
http://localhost:3000/microsoft/vscode/
http://localhost:3000/microsoft/vscode/VSCodeSetup-x64-1.82.0.exe
```


