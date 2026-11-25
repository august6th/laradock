# ERP 的 PHP 8.4 并行环境

2026-10-27 的实际构建、HTTP 和兼容性检查结果见 [验收记录](VERIFICATION.md)。

这是原 Laradock 仓库的一部分。继续使用同一个 `docker-compose.yml`、
`APP_CODE_PATH_HOST`、Nginx 和 `backend` 网络，不需要另拉 ERP 项目，
也不需要新的 Compose 项目、数据库或 Redis。

## 服务与配置

| 服务 | 用途 | 启用方式 |
| --- | --- | --- |
| `workspace` / `php-fpm` | 现有 PHP，版本仍由 `PHP_VERSION` 决定 | 原命令 |
| `workspace-56` / `php-fpm-56` | 仓库已有的 PHP 5.6 | 原命令 |
| `workspace-84` | Composer、Artisan、测试 | `php84` profile |
| `php-fpm-84` | PHP 8.4 的 HTTP 请求 | `php84` profile |
| `php-worker-84` | 单个已迁移应用的队列 | `php84-jobs` profile，单独启用 |

构建方式沿用原服务，CLI 与 FPM 分别构建：

| 服务 | 原构建目录 | 配置来源 |
| --- | --- | --- |
| `workspace-84` | `workspace/` | `WORKSPACE_INSTALL_*`、原 Node/Yarn/Composer 设置、`laradock` 用户及 aliases |
| `php-fpm-84` | `php-fpm/` | `PHP_FPM_INSTALL_*`、`php-fpm/php8.4.ini`、原 `laravel.ini` |
| `php-worker-84` | 复用 workspace-84 镜像 | 以 `laradock` 用户显式执行目标应用队列 |

PHP 分支为 **8.4**，构建最低补丁版本为 **8.4.27**。`.env.example` 提供：

```dotenv
PHP84_VERSION=8.4
PHP84_MIN_VERSION=8.4.27
PHP_FPM84_BASE_IMAGE=php:8.4.27-fpm-bookworm
PHP84_XDEBUG_VERSION=3.5.3
WORKSPACE84_AST_VERSION=1.1.3
WORKSPACE84_NPM_REGISTRY=https://registry.npmjs.org/
PHP84_WORKER_PATH=/var/www/erp/iss
```

已有 `.env` 不必覆盖：未添加新变量时，Compose 使用上述默认值。
保留原 `PHP_VERSION`，通过新增服务选择 8.4。workspace 仍以
`laradock/workspace:latest-8.4` 为基础并更新 PHP 软件包，保留原 CLI 路径
`/etc/php/8.4/cli/php.ini`。原 FPM 基础镜像源没有 8.4 标签，因此在原
Dockerfile 中增加可配置的 `BASE_IMAGE`；8.4 默认使用官方 PHP 镜像并补齐基础扩展。
旧 PHP 默认基础镜像来源保持不变。两个构建均检查最低补丁版本。
现有 `APP_CODE_PATH_HOST` 必须指向包含 ERP 代码的目录；
新服务挂载的容器路径仍使用 `APP_CODE_PATH_CONTAINER`。
`PHP84_WORKER_PATH` 是容器内路径，要随目标应用调整。

workspace 使用原 `WORKSPACE_PUID` / `WORKSPACE_PGID` 创建 `laradock` 用户，
FPM 使用原 `PHP_FPM_PUID` / `PHP_FPM_PGID`。原有扩展和开发工具安装开关继续生效；
8.4 为 Xdebug、AST、Redis、Memcached、Memcache 增加了兼容处理。
可选扩展的兼容性取决于上游，验收记录列出本机实际开启和验证的组合。

workspace 通过 `workspace/php84.ini` 关闭 upload progress 和 PHP 版本暴露；
FPM 沿用版本独立的完整 ini，并通过 `php84.pool.conf` 固定这两项设置。
原 `laravel.ini` 等配置仍按原 Dockerfile 加载。Node/Yarn 版本沿用原 `.env`，
不随 PHP 自动升级；8.4 的 npm 源可通过 `WORKSPACE84_NPM_REGISTRY` 单独设置。
新增服务的 SSH、前端工具和 Xdebug 宿主端口单独配置，默认只绑定本机。

workspace 仍使用原启动方式与 cron 服务，但为 8.4 挂载独立的
`workspace/crontab/laradock-84`（默认无应用任务），避免与旧 workspace 重复调度。

## 构建与启动

以下命令都在 Laradock 仓库根目录执行，需要 Docker Compose v2。
首次使用仍需按团队原流程准备本机 `.env`、ERP 代码和数据库。

```sh
docker compose --profile php84 build workspace-84 php-fpm-84
docker compose --profile php84 up -d --no-build --wait workspace-84 php-fpm-84
docker compose exec workspace-84 php -v
docker compose exec workspace-84 composer --version
docker compose exec --user laradock workspace-84 bash
```

Nginx 沿用已有服务和端口。`nginx/sites/php84.conf` 是独立诊断域名，
只检查 PHP 运行时，不读取业务 `.env`、不启动 Laravel，也不访问数据库。
该配置延迟解析 Docker DNS，因此关闭 8.4 服务时仍能正常检查和启动 Nginx；
此时访问诊断入口会返回 502。

已有 Nginx 正在运行时：

```sh
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
curl -H 'Host: php84.laradock.test' http://127.0.0.1/__runtime
node --test php84/acceptance.mjs
```

使用其他 HTTP 端口时，设置 `PHP84_TEST_URL=http://127.0.0.1:端口` 再运行测试。
通过域名浏览时，在本机 hosts 中添加 `127.0.0.1 php84.laradock.test`。
Nginx 未启动时沿用 `docker compose up -d nginx`；这也会启动其原有依赖。
如果 `NGINX_SITES_PATH` 指向自定义目录，需要将诊断配置放入该目录再 reload。

验收脚本检查 CLI 扩展、实际 Nginx → FPM 路由、上传、诊断站点的路径保护，
并确认旧 CLI 版本继续符合原配置，以及新旧容器能读取同一代码目录的临时文件。
临时文件会在检查后删除；不会执行数据库迁移或业务队列。
FPM 的 Docker health check 使用实际 FastCGI ping。

## 按应用切换 PHP

ISS 当前旧版 Laravel 5.5 和依赖尚不能在 PHP 8.4 启动。先迁移应用和依赖，
再切换它的站点；运行时诊断通过不代表 ERP 已兼容。

`nginx/sites/erp.php84.conf.example` 提供独立测试域名的示例，默认不被 Nginx 加载。
应用准备好后，可按需复制成 `.conf`，调整 `server_name` 和 `root` 后检查并 reload。
示例 root 沿用 `/var/www/erp/iss/public`，引用现有代码目录。

切换已有站点时，在对应的 `server` 块加入：

```nginx
resolver 127.0.0.11 ipv6=off valid=10s;
set $erp_php_upstream php-fpm-84:9000;
```

将该站点的 `fastcgi_pass php-upstream;` 改为：

```nginx
fastcgi_pass $erp_php_upstream;
```

保留该站点现有的路由、CORS、路径和日志设置，检查配置后 reload。
其他站点仍然使用 `php-upstream` 和原来的 PHP。
回退时将此站点恢复为 `fastcgi_pass php-upstream;`，检查后 reload。

CLI 明确选择版本，例如：

```sh
docker compose exec -w /var/www/erp/iss workspace-84 php artisan --version
docker compose exec -w /var/www/erp/iss workspace-84 composer --no-plugins --no-scripts check-platform-reqs
```

新服务连接的是现有开发网络，使用代码目录原有的应用环境配置，
没有额外的数据隔离。执行迁移、队列或定时任务前，核实应用配置的数据库、
Redis、外部回调和 `PHP84_WORKER_PATH` 都是预期的开发目标。
应用及队列验证完成后才启用后台服务：

```sh
docker compose --profile php84-jobs up -d --no-build php-worker-84
```

该队列服务使用 `restart: unless-stopped`，在队列重启、内存回收或超时退出后自动恢复。

需要定时任务时，在应用兼容性验收后编辑 `workspace/crontab/laradock-84`，
或在相同应用目录显式执行 `php artisan schedule:run`。

## 团队同步与停止

把本次 Compose、`.env.example`、`workspace/`、`php-fpm/`、`php84/`、
Nginx 配置及文档修改一起提交到团队仓库。
不要提交本机 `.env`、vendor、数据库、日志或无关的 `nginx/sites.zip`。
同事拉取后按上面的构建、启动和 Nginx 检查命令操作即可，
不依赖任何个人绝对路径、临时 worktree 或本机已有的试验镜像。

只停止新增服务：

```sh
docker compose stop workspace-84 php-fpm-84
# 仅当此前启动过队列服务：
docker compose stop php-worker-84
```

不要为此执行 `docker compose down`，它会影响整个现有 Laradock 项目。
更新 8.4 补丁时同时更新 `PHP84_MIN_VERSION` 与 `PHP_FPM84_BASE_IMAGE`，
使用 `build --pull --no-cache workspace-84 php-fpm-84` 刷新基础镜像和软件包，
再启动新增服务并运行验收。`PHP84_VERSION` 保持 `8.4`；
切换其他 PHP 分支需要独立验证其 Dockerfile 和扩展兼容性。
本机 Docker 客户端若注入了容器无法连接的代理，应修正 Docker 代理设置，
或在本次 build 中显式传入空的大小写 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 构建参数。
生产部署和业务回归需要另外验收。
