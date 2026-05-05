import chalk from 'chalk';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { crossPlatformSpawn, killProcess } from '../platform-utils.js';

interface StartOptions {
  port?: string;
  stdio?: boolean;
  verbose?: boolean;
}

// Resolve the bundled server entry from this file's location, not from CWD.
// Layout (after build): dist/cli/commands/start.js → ../../index.js (stdio)
//                                                  → ../../http-server.js (http)
const moduleDir = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(moduleDir, '..', '..');

function logToStderr(...args: unknown[]) {
  // Stdio mode reserves stdout for MCP framing — chatty output must go to stderr.
  console.error(...args);
}

export async function startCommand(options: StartOptions) {
  const log = options.stdio ? logToStderr : console.log;
  log(chalk.bold.green('🚀 Starting Twenty MCP Server'));

  // The bundled package always ships dist/. If we are running from a source
  // checkout without dist/ (i.e. dev), fall back to building once.
  if (!existsSync(distRoot) || !existsSync(join(distRoot, 'index.js'))) {
    log(chalk.yellow('⚠️  Bundled server entry not found; running build...'));
    await buildProject(options.stdio);
  }

  // Configuration: env vars passed via the parent process (Claude Code's
  // MCP env block, exported shell env, etc.) take precedence. A .env file
  // in CWD is honoured when present but is no longer required, so this
  // works under `npx`, global install, or Docker.
  const envPath = join(process.cwd(), '.env');
  const haveEnvFile = existsSync(envPath);
  const haveEnvVars = !!process.env.TWENTY_API_KEY;
  if (!haveEnvFile && !haveEnvVars) {
    logToStderr(chalk.red('❌ No configuration found.'));
    logToStderr(chalk.gray('   Set TWENTY_API_KEY (and optionally TWENTY_BASE_URL) in your environment,'));
    logToStderr(chalk.gray('   or create a .env file via "twenty-mcp setup".'));
    process.exit(1);
  }

  const mode = options.stdio ? 'stdio' : 'http';
  const port = options.port || '3000';
  log(chalk.gray(`Starting server in ${mode} mode...`));

  if (options.verbose) {
    process.env.DEBUG = 'twenty-mcp:*';
  }

  const serverScript = options.stdio ? 'index.js' : 'http-server.js';
  const serverPath = join(distRoot, serverScript);
  if (!existsSync(serverPath)) {
    logToStderr(chalk.red(`❌ Server file not found: ${serverPath}`));
    logToStderr(chalk.gray('   The package may be corrupted; try reinstalling.'));
    process.exit(1);
  }

  if (!options.stdio) {
    process.env.PORT = port;
    log(chalk.cyan(`Starting: node ${serverPath}`));
    log(chalk.gray(`HTTP server will be available at: http://localhost:${port}`));
    log(chalk.gray('Press Ctrl+C to stop\n'));
  }

  const serverProcess = crossPlatformSpawn('node', [serverPath], {
    // In stdio mode, the child must own stdin/stdout for MCP framing —
    // anything we print to stdout would corrupt the protocol.
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n🛑 Stopping server...'));
    killProcess(serverProcess, 'SIGINT');
  });

  process.on('SIGTERM', () => {
    console.log(chalk.yellow('\n🛑 Stopping server...'));
    killProcess(serverProcess, 'SIGTERM');
  });

  serverProcess.on('close', (code) => {
    if (code !== 0) {
      console.log(chalk.red(`❌ Server exited with code ${code}`));
    } else {
      console.log(chalk.green('✅ Server stopped'));
    }
    process.exit(code || 0);
  });

  serverProcess.on('error', (error) => {
    console.error(chalk.red('❌ Failed to start server:'), error.message);
    process.exit(1);
  });
}

async function buildProject(stdio?: boolean): Promise<void> {
  // Build runs from the package root (where package.json lives), not CWD.
  // For installed packages the package root is the parent of dist/.
  const packageRoot = resolve(distRoot, '..');
  return new Promise((resolveFn, reject) => {
    const buildProcess = crossPlatformSpawn('npm', ['run', 'build'], {
      // Build output is chatty; in stdio mode it must go to stderr only.
      stdio: stdio ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      cwd: packageRoot,
    });

    buildProcess.on('close', (code) => {
      if (code === 0) {
        console.error(chalk.green('✅ Build completed'));
        resolveFn();
      } else {
        console.error(chalk.red('❌ Build failed'));
        reject(new Error(`Build failed with code ${code}`));
      }
    });

    buildProcess.on('error', (error) => {
      console.error(chalk.red('❌ Build error:'), error.message);
      reject(error);
    });
  });
}