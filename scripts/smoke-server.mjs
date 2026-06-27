// 부팅 스모크 — server.js 가 실제로 기동(listen)하는지 검증한다.
//
// 왜 필요한가: server.js 는 .js(ESM) 파일이라 typecheck(tsconfig include=src) 와
// build(vite, 프런트만 번들) 어디에도 잡히지 않는다. 그래서 ESM 레포에 CommonJS
// `require(...)` 를 넣는 식의 "부팅 시점에만 터지는" 크래시가 모든 게이트를 통과한다.
// 이 스크립트는 서버를 실제로 한 번 띄워서 listen 까지 도달하는지로 그 부류 전체
// (잘못된 require/import·최상위 throw·문법 오류)를 잡는다. 뜨면 통과, 죽으면 실패.
//
// DB 없이 결정적으로: 자식 env 에 DATABASE_URL='' (빈값이면 server.js 의 .env 파서가
// 덮지 않는다) + ALLOW_MOCK_FALLBACK='true' 를 주면 mock pool 로 app.listen 까지 간다.
// PORT=5099 는 Number('5099')||5000 → 5099 로 확정되어 실행 중인 개발 백엔드(5000)와
// 충돌하지 않는다.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
// 기본은 server.js. 인자로 다른 엔트리를 줄 수 있다(예: 회귀 테스트로 깨진 사본 검증).
const serverPath = path.resolve(repoRoot, process.argv[2] || 'server.js');

const READY = 'API server listening';
const TIMEOUT_MS = 20000;

const child = spawn(process.execPath, [serverPath], {
  cwd: repoRoot,
  env: { ...process.env, ALLOW_MOCK_FALLBACK: 'true', DATABASE_URL: '', PORT: '5099' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
let done = false;

const finish = (code, reason) => {
  if (done) return;
  done = true;
  clearTimeout(timer);
  try { child.kill(); } catch { /* already gone */ }
  if (code === 0) {
    console.log(`[smoke] OK — server booted (saw "${READY}")`);
  } else {
    console.error(`[smoke] FAIL — ${reason}`);
    console.error('----- server output -----');
    console.error(out.trim() || '(no output)');
    console.error('-------------------------');
  }
  // 자식 종료가 전파되도록 한 틱 양보 후 종료 코드 반영
  setTimeout(() => process.exit(code), 100);
};

const onData = (buf) => {
  out += buf.toString();
  if (out.includes(READY)) finish(0);
};

child.stdout.on('data', onData);
child.stderr.on('data', onData);
child.on('error', (err) => finish(1, `failed to spawn: ${err.message}`));
child.on('exit', (code, signal) => {
  // 준비 신호 전에 종료되면 부팅 크래시로 간주
  if (!done) finish(1, `process exited before listening (code=${code}, signal=${signal})`);
});

const timer = setTimeout(
  () => finish(1, `timed out after ${TIMEOUT_MS}ms without "${READY}"`),
  TIMEOUT_MS,
);
