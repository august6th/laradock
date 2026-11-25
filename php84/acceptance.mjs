import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import test from "node:test";
import { fileURLToPath } from "node:url";

const composeFile = fileURLToPath(new URL("../docker-compose.yml", import.meta.url));
const base = process.env.PHP84_TEST_URL || "http://127.0.0.1";

// Some Node fetch versions discard an explicit Host header.
function request(path, { method = "GET", headers = {}, body } = {}) {
  const url = new URL(path, base);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const outgoing = transport.request(url, {
      method,
      headers: {
        ...headers,
        Host: "php84.laradock.test",
        ...(body ? { "Content-Length": body.length } : {}),
      },
      signal: AbortSignal.timeout(10000),
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

function compose(...args) {
  return execFileSync("docker", ["compose", "-f", composeFile, ...args], {
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function assertEnabledExtensions(service, loaded) {
  const config = JSON.parse(compose("--profile", "php84", "config", "--format", "json"));
  const args = config.services[service].build.args;
  for (const [flag, extension] of [
    ["INSTALL_BCMATH", "bcmath"], ["INSTALL_GMP", "gmp"],
    ["INSTALL_MYSQLI", "mysqli"], ["INSTALL_INTL", "intl"],
    ["INSTALL_PHPREDIS", "redis"], ["INSTALL_MEMCACHED", "memcached"],
    ["INSTALL_MEMCACHE", "memcache"], ["INSTALL_XDEBUG", "xdebug"],
    ["INSTALL_AST", "ast"], ["INSTALL_SOAP", "soap"],
    ["INSTALL_EXIF", "exif"], ["INSTALL_PCNTL", "pcntl"],
  ]) {
    if (args[flag] === "true") {
      assert.ok(loaded.includes(extension), `${service}: enabled ${extension} is missing`);
    }
  }
}

test("workspace retains the original Laradock CLI layout and enabled development tools", () => {
  const config = JSON.parse(compose("--profile", "php84", "config", "--format", "json"));
  const enabled = config.services.workspace.build.args;
  const layout = JSON.parse(compose("exec", "-T", "workspace-84", "php", "-r", `
    echo json_encode([
      'ini' => php_ini_loaded_file(),
      'aliases' => is_file('/home/laradock/aliases.sh'),
      'composer_home' => is_dir('/home/laradock/.composer')
    ]);
  `));
  assert.equal(layout.ini, "/etc/php/8.4/cli/php.ini");
  assert.equal(layout.aliases, true);
  assert.equal(layout.composer_home, true);
  assert.equal(compose("exec", "-T", "workspace-84", "id", "-u", "laradock").trim(),
    enabled.PUID);
  if (enabled.INSTALL_NODE === "true") {
    assert.match(compose("exec", "-T", "workspace-84", "node", "--version"), /^v\d+\./);
    assert.match(compose("exec", "-T", "workspace-84", "npm", "--version"), /^\d+\./);
    for (const [flag, command] of [
      ["INSTALL_NPM_GULP", "gulp"], ["INSTALL_NPM_VUE_CLI", "vue"],
    ]) {
      if (enabled[flag] === "true") {
        assert.match(compose("exec", "-T", "workspace-84", command, "--version"), /\d+\./);
      }
    }
  }
  if (enabled.INSTALL_YARN === "true") {
    assert.match(compose("exec", "-T", "workspace-84", "yarn", "--version"), /^\d+\./);
  }
  for (const [flag, extension] of [
    ["INSTALL_XDEBUG", "xdebug"], ["INSTALL_AST", "ast"],
    ["INSTALL_MEMCACHE", "memcache"], ["INSTALL_PHPREDIS", "redis"],
  ]) {
    if (enabled[flag] === "true") {
      assert.equal(compose("exec", "-T", "workspace-84", "php", "-r",
        "echo extension_loaded($argv[1]) ? 'yes' : 'no';", extension), "yes", extension);
    }
  }
});

test("workspace uses PHP 8.4 with the ERP extensions and upload setting", () => {
  const result = JSON.parse(compose("exec", "-T", "workspace-84", "php", "-r", `
    echo json_encode([
      'version' => PHP_VERSION,
      'missing' => array_values(array_filter(
        ['pdo_mysql', 'mbstring', 'gd', 'zip', 'xml', 'curl'],
        fn ($name) => !extension_loaded($name)
      )),
      'upload_progress' => (bool) ini_get('session.upload_progress.enabled'),
      'extensions' => get_loaded_extensions()
    ]);
  `));
  assert.match(result.version, /^8\.4\./);
  assert.ok(Number(result.version.split(".")[2]) >= 27);
  assert.deepEqual(result.missing, []);
  assert.equal(result.upload_progress, false);
  assertEnabledExtensions("workspace-84", result.extensions);
});

test("existing Laradock Nginx routes the diagnostic host to PHP 8.4 FPM", async () => {
  const response = await request("/__runtime");
  assert.equal(response.status, 200);
  const runtime = JSON.parse(response.body);
  assert.match(runtime.php_version, /^8\.4\./);
  assert.ok(Number(runtime.php_version.split(".")[2]) >= 27);
  assert.equal(runtime.sapi, "fpm-fcgi");
  assert.equal(runtime.session_upload_progress, false);
  assert.equal(runtime.expose_php, false);
  assert.deepEqual(runtime.missing_extensions, []);
  assertEnabledExtensions("php-fpm-84", runtime.extensions);
});

test("PHP 8.4 accepts multipart uploads through the existing Nginx", async () => {
  const sample = "laradock-php84-upload-check";
  const form = new FormData();
  form.set("sample", new Blob([sample]), "sample.txt");
  const upload = new Response(form);
  const response = await request("/__runtime", {
    method: "POST",
    headers: { "Content-Type": upload.headers.get("content-type") },
    body: Buffer.from(await upload.arrayBuffer()),
  });
  assert.equal(response.status, 200);
  const runtime = JSON.parse(response.body);
  assert.equal(runtime.upload_sha256, createHash("sha256").update(sample).digest("hex"));
  for (const path of ["/.env", "/composer.json", "/.git/config", "/index.php"]) {
    const blocked = await request(path);
    assert.equal(blocked.status, 404, path);
  }
});

test("the legacy PHP selection still works and both runtimes share the configured code directory", () => {
  const config = JSON.parse(compose("--profile", "php84", "config", "--format", "json"));
  const expected = config.services.workspace.build.args.LARADOCK_PHP_VERSION;
  const version = compose("exec", "-T", "workspace", "php", "-r", "echo PHP_VERSION;");
  assert.ok(version.startsWith(`${expected}.`), `Legacy CLI should remain on PHP ${expected}`);
  const path = compose("exec", "-T", "workspace-84", "php", "-r", `
    $file = tempnam(getcwd(), '.laradock-php84-check-');
    if ($file === false || dirname($file) !== getcwd()) {
      throw new RuntimeException('Code directory is not writable');
    }
    file_put_contents($file, 'laradock-shared-code-check');
    echo $file;
  `).trim();
  try {
    const read = "echo file_get_contents($argv[1]);";
    for (const service of ["php-fpm-84", "workspace"]) {
      assert.equal(compose("exec", "-T", service, "php", "-r", read, path),
        "laradock-shared-code-check", service);
    }
  } finally {
    compose("exec", "-T", "workspace-84", "php", "-r", "unlink($argv[1]);", path);
  }
});
