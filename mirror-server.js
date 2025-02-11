const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');

const REPOS_FILE = 'repos.txt';
const PORT = 3000;

// 获取仓库列表
function getRepositories() {
    try {
        const data = fs.readFileSync(REPOS_FILE, 'utf-8');
        return data.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
    } catch (error) {
        console.error('读取仓库列表失败:', error.message);
        return [];
    }
}

// 处理单个仓库
async function processRepository(repo) {
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) return;

    console.log(`正在处理仓库: ${repo}`);
    
    try {
        // 获取最新release信息
        const releaseResponse = await axios.get(
            `https://api.github.com/repos/${owner}/${repoName}/releases/latest`,
            { headers: { 'User-Agent': 'Node.js Mirror Server' } }
        );
        
        const releaseData = releaseResponse.data;
        const repoDir = path.join(__dirname, repo);
        const manifestPath = path.join(repoDir, 'manifest.json');

        // 创建仓库目录
        fs.mkdirSync(repoDir, { recursive: true });

        // 清空旧文件
        fs.readdirSync(repoDir)
            .filter(file => file !== 'manifest.json')
            .forEach(file => fs.rmSync(path.join(repoDir, file)));

        // 下载所有资源文件
        await Promise.all(releaseData.assets.map(async asset => {
            const filePath = path.join(repoDir, asset.name);
            const writer = fs.createWriteStream(filePath);
            
            const response = await axios({
                url: asset.browser_download_url,
                method: 'GET',
                responseType: 'stream'
            });

            response.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
        }));

        // 生成manifest文件
        const manifest = {
            repository: repo,
            version: releaseData.tag_name,
            published_at: releaseData.published_at,
            author: releaseData.author.login,
            assets: releaseData.assets.map(asset => ({
                name: asset.name,
                size: asset.size,
                download_count: asset.download_count
            }))
        };

        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        console.log(`仓库 ${repo} 更新完成，版本: ${releaseData.tag_name}`);

    } catch (error) {
        console.error(`处理仓库 ${repo} 时出错:`, error.message);
    }
}

// 定时更新任务
function scheduleUpdates() {
    cron.schedule('0 3 * * *', () => {
        console.log('\n开始执行定时更新...');
        const repos = getRepositories();
        repos.forEach(processRepository);
    });
}

// 启动Web服务器
function startWebServer() {
    const app = express();
    
    // 静态文件服务
    app.use(express.static(__dirname));
    
    // 仓库列表展示
    app.get('/', (req, res) => {
        const repos = getRepositories();
        const html = `<h1>天镜 - 天外开源软件镜像站</h1><ul>${
            repos.map(repo => `
                <li>
                    <a href="/${repo}/">${repo}</a>
                    <a href="/${repo}/manifest.json">(manifest)</a>
                </li>`
            ).join('')
        }</ul>`;
        res.send(html);
    });

    app.listen(PORT, () => {
        console.log(`下载服务已启动: http://localhost:${PORT}`);
    });
}

// 初始化
function main() {
    scheduleUpdates();
    startWebServer();
    console.log('首次启动立即执行一次更新...');
    getRepositories().forEach(processRepository);
}

main();
