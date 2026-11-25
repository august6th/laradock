# 原 Laradock 的 PHP 8.4 验收记录

日期：2026-10-27，Asia/Shanghai。

仓库：原 Laradock，分支 `liheng/2025112`；
基线提交 `7f85842c421daa475df424c9bfe137e0a764f9b4`。

## 构建方式

- `workspace-84` 使用原 `workspace/Dockerfile` 和 Laradock workspace 基础镜像，
  保留 `laradock` 用户、CLI 配置路径、aliases、Composer、Node/Yarn 及原扩展开关。
- `php-fpm-84` 使用原 `php-fpm/Dockerfile` 和 `PHP_FPM_INSTALL_*`，
  8.4 单独选择官方 PHP 基础镜像；旧 PHP 的默认基础镜像来源保持不变。
- 已删除上一版 `php84/Dockerfile` 和共用精简镜像配置。
  `php84/` 仅保留诊断脚本、验收脚本和文档。
- 原 FPM 镜像源的 8.4 标签不存在；本机拉取的 Laradock FPM 8.4 镜像为
  8.4.26，因此没有用它降低最低补丁要求。

## 实际验收

| 项目 | 结果 |
| --- | --- |
| 旧服务配置 | HEAD 与当前 Compose 的 103 个原有服务、网络及数据卷定义逐项相等 |
| 示例配置 | `.env.example` 配合两个新 profile 执行 `config --quiet`，退出 0 |
| 原 Dockerfile 构建 | `workspace-84` 与 `php-fpm-84` 分别构建，均退出 0；最终镜像启动后再次验收 |
| CLI / FPM | 均为 PHP 8.4.27；两个构建均有最低补丁版本检查 |
| CLI 布局 | `/etc/php/8.4/cli/php.ini`、aliases、Composer 目录均存在 |
| CLI 用户 | `laradock` UID/GID 1000，与本机原配置一致 |
| 开发工具 | Composer 2.10.3、Node v14.17.3、npm 6.14.13、Yarn 1.22.22；启用的 gulp、Vue CLI 可执行 |
| 启用的扩展 | CLI 的 GMP、Xdebug、Redis、Memcached、Memcache、AST，以及 FPM 的 BCMath、GMP、mysqli、Intl、Redis、Memcached、Memcache、Xdebug、OPcache 均加载成功 |
| 安全配置 | CLI/FPM upload progress 关闭，FPM 不暴露 PHP 版本 |
| FPM 健康检查 | 实际 FastCGI ping 通过，容器 healthy |
| HTTP / 上传 | 原 Nginx 的诊断 Host 返回 200、`fpm-fcgi`；multipart 上传文件摘要一致 |
| 路径保护 | 诊断站点的 `.env`、`composer.json`、`.git/config`、`index.php` 均返回 404 |
| 旧 PHP / 代码目录 | 原 CLI 保持 PHP 7.1；新 CLI 写入的临时文件能被新 FPM 和旧 CLI 读取，随后删除 |
| 定时任务 | 新 workspace 的独立 cron 文件只有注释，没有应用任务 |
| 集成验收 | `node --test php84/acceptance.mjs`，5 passed、0 failed |
| 旧容器 | 原 workspace、FPM、Nginx 的 ID 和启动时间与改造前一致 |
| Node/Yarn 关闭 | 单独测试镜像构建成功，PHP/Composer 可用，node/npm/yarn 均未安装 |
| 现代 Node/npm | 单独选择 `NODE_VERSION=node` 构建成功；Node v26.12.1、npm 11.20.0、Yarn 1.22.22、gulp CLI 3.1.0、Vue CLI 5.0.9 实际可执行，全局工具目录存在 |

构建使用本机实际 `.env` 中的原安装开关。未验证所有可选扩展组合。
测试 Node 关闭组合时使用独立镜像标签，避免覆盖团队现有 Node 版本。
现代 Node 组合也使用独立标签，仅验证工具可执行，未运行 ERP 前端依赖安装或打包。

## 构建中修复的问题

- Ubuntu 24.04 基础镜像的默认 `ubuntu` 用户占用 UID/GID 1000；
  8.4 分支先删除该基础镜像用户，再按原流程创建 `laradock`。
- 新软件源使用 `.sources` 文件，原换源逻辑只识别 `sources.list`；
  现支持两种格式。
- 原 Xdebug、AST、Redis 版本不兼容 8.4，增加对应的兼容安装分支。
- libmemcached 的 pkg-config 元数据需要 `libcrypto`，FPM 增加 `libssl-dev`；
  仅指定库目录不能解决此问题。
- 原 `npm bin --global` 已被现代 npm 移除，改用兼容新旧 npm 的
  `npm prefix --global`；设置 npm registry 时同时检查 Node 安装开关。
- 验收脚本读取 Compose 配置时显式启用 `php84` profile。

本机 Docker 客户端注入的 `127.0.0.1:7897` 代理无法被构建容器连接。
实测直连软件源可用，构建时清空大小写 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 参数。
未把本机代理地址写入仓库，也未覆盖本机 `.env`。

## 验收边界

- ISS 仍是 Laravel 5.5 与旧依赖，上一轮已确认 Artisan、Faker、PHPUnit
  与 PHP 8.4 不兼容。本次没有改业务代码或切换业务站点。
- 未启动 `php-worker-84`，未执行业务调度、迁移、数据导入或外部回调。
- 新服务沿用原开发网络和代码挂载，没有额外的数据隔离。
- 实测平台为当前 ARM64 Docker；其他 CPU 架构及同事机器尚未验收。
- `.env.example` 已验证 Compose 解析；完整构建使用本机安装开关，
  不能据此认定示例中的所有可选软件组合均可构建。
- 未推送 GitLab。当前 `origin` 指向 GitHub，未擅自修改远端。
- 不包含生产部署及 ERP 业务兼容性验收。
