const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

// Configuration
const TELEGRAM_BOT_TOKEN = '8343783715:AAGDS6aiRPgei9zCLl25EECApgQCasdJzQA';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const ADMIN_PASSWORD = 'breakingbad1'; // Change this!
const SERVER_FILE = 'C:\\jude\\backend\\server.js';
const BACKUP_DIR = 'C:\\jude\\backend\\backups';
const LOG_FILE = 'C:\\jude\\backend\\server.log';
const DEVBOT_FILE = 'C:\\jude\\backend\\devbot.js';
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_COOLDOWN = 300000; // 5 minutes

let authenticatedChatId = null;
let serverProcess = null;
let isEditMode = false;
let editBuffer = '';
let healthCheckTimer = null;
let lastHealthCheck = Date.now();
let crashCount = 0;
let lastCrashTime = 0;
let restartAttempts = 0;
let serverStartTime = null;
let isShuttingDown = false;
let errorBuffer = [];
let lastSuccessfulStart = null;

// Create backup directory
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Setup error logging
process.on('uncaughtException', (error) => {
  console.error('CRITICAL ERROR:', error);
  logError('uncaughtException', error);
  sendTelegramMessage(`🚨 <b>CRITICAL BOT ERROR</b>\n<code>${error.message}</code>\n\nBot still running...`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  logError('unhandledRejection', reason);
});

console.log('🤖 Telegram Dev Bot Starting...');
console.log(`📁 Managing: ${SERVER_FILE}`);
console.log('🛡️ Safety features enabled');
console.log('🔐 Waiting for authentication...');

// Error logging
function logError(type, error) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    type,
    message: error.message || String(error),
    stack: error.stack
  };
  
  errorBuffer.push(logEntry);
  if (errorBuffer.length > 50) errorBuffer.shift();
  
  const errorLogFile = path.join(BACKUP_DIR, 'error.log');
  fs.appendFileSync(errorLogFile, JSON.stringify(logEntry) + '\n');
}

// Telegram API Helper with retry
function sendTelegramMessage(text, options = {}, retries = 3) {
  if (!authenticatedChatId) return;
  
  const data = JSON.stringify({
    chat_id: authenticatedChatId,
    text: text.substring(0, 4000), // Telegram limit
    parse_mode: options.parseMode || 'HTML',
    ...options
  });

  const attempt = (retriesLeft) => {
    const req = https.request(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200 && retriesLeft > 0) {
          setTimeout(() => attempt(retriesLeft - 1), 2000);
        }
      });
    });

    req.on('error', (e) => {
      console.error('Telegram request error:', e.message);
      if (retriesLeft > 0) {
        setTimeout(() => attempt(retriesLeft - 1), 2000);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      if (retriesLeft > 0) {
        setTimeout(() => attempt(retriesLeft - 1), 2000);
      }
    });
    
    req.write(data);
    req.end();
  };

  attempt(retries);
}

// Create Backup with error handling
function createBackup() {
  if (!fs.existsSync(SERVER_FILE)) {
    return { success: false, error: 'Server file not found' };
  }
  
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const backupFile = path.join(BACKUP_DIR, `server_${timestamp}.js`);
  
  try {
    fs.copyFileSync(SERVER_FILE, backupFile);
    
    // Keep only last 20 backups
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('server_') && f.endsWith('.js'))
      .sort()
      .reverse();
    
    if (backups.length > 20) {
      backups.slice(20).forEach(f => {
        try {
          fs.unlinkSync(path.join(BACKUP_DIR, f));
        } catch (e) {}
      });
    }
    
    return { success: true, file: backupFile };
  } catch (e) {
    logError('backup', e);
    return { success: false, error: e.message };
  }
}

// List Backups
function listBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.js') && f.startsWith('server_'))
      .sort()
      .reverse()
      .slice(0, 10);
    return files;
  } catch (e) {
    return [];
  }
}

// Restore Backup
function restoreBackup(filename) {
  const backupFile = path.join(BACKUP_DIR, filename);
  
  if (!fs.existsSync(backupFile)) {
    return { success: false, error: 'Backup file not found' };
  }
  
  try {
    createBackup(); // Backup current before restoring
    fs.copyFileSync(backupFile, SERVER_FILE);
    return { success: true };
  } catch (e) {
    logError('restore', e);
    return { success: false, error: e.message };
  }
}

// Health Check
function startHealthCheck() {
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  
  healthCheckTimer = setInterval(() => {
    if (!serverProcess) return;
    
    const now = Date.now();
    const uptime = (now - serverStartTime) / 1000;
    
    // Check if process is still alive
    try {
      process.kill(serverProcess.pid, 0);
      lastHealthCheck = now;
    } catch (e) {
      // Process died unexpectedly
      console.error('Server process died unexpectedly');
      sendTelegramMessage('🚨 <b>SERVER CRASHED</b>\n\nAttempting auto-restart...');
      serverProcess = null;
      handleServerCrash();
    }
    
    // Log health every 5 minutes
    if (uptime > 0 && uptime % 300 < 1) {
      const uptimeStr = formatUptime(uptime);
      console.log(`✅ Health check: Server running for ${uptimeStr}`);
    }
  }, HEALTH_CHECK_INTERVAL);
}

// Handle Server Crash
function handleServerCrash() {
  const now = Date.now();
  
  // Reset crash count if last crash was over cooldown period
  if (now - lastCrashTime > RESTART_COOLDOWN) {
    crashCount = 0;
  }
  
  crashCount++;
  lastCrashTime = now;
  
  if (crashCount > MAX_RESTART_ATTEMPTS) {
    sendTelegramMessage(
      `🚨 <b>CRITICAL: Server crashed ${crashCount} times</b>\n\n` +
      `Auto-restart disabled. Manual intervention required.\n\n` +
      `Use /forcestart to restart or /logs to check errors.`
    );
    return;
  }
  
  sendTelegramMessage(`🔄 Auto-restarting server (attempt ${crashCount}/${MAX_RESTART_ATTEMPTS})...`);
  
  setTimeout(() => {
    const result = startServer();
    if (!result.success) {
      sendTelegramMessage(`❌ Auto-restart failed: ${result.error}`);
    }
  }, 5000);
}

// Format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  let result = [];
  if (days > 0) result.push(`${days}d`);
  if (hours > 0) result.push(`${hours}h`);
  if (minutes > 0) result.push(`${minutes}m`);
  if (secs > 0 || result.length === 0) result.push(`${secs}s`);
  
  return result.join(' ');
}

// Start Server with safety checks
function startServer() {
  if (serverProcess) {
    return { success: false, error: 'Server already running' };
  }
  
  if (isShuttingDown) {
    return { success: false, error: 'Server is shutting down, please wait' };
  }
  
  // Validate file exists
  if (!fs.existsSync(SERVER_FILE)) {
    return { success: false, error: 'server.js not found' };
  }
  
  // Validate syntax before starting
  try {
    const content = fs.readFileSync(SERVER_FILE, 'utf8');
    const validation = validateSyntax(content);
    if (!validation.valid) {
      return { success: false, error: `Syntax error: ${validation.error}` };
    }
  } catch (e) {
    return { success: false, error: `Cannot read file: ${e.message}` };
  }
  
  try {
    const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    
    // Use node server.js directly
    serverProcess = spawn('node', ['server.js'], {
      cwd: 'C:\\jude\\backend',
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: false
    });
    
    serverStartTime = Date.now();
    restartAttempts = 0;
    lastSuccessfulStart = Date.now();
    
    serverProcess.stdout.pipe(logStream);
    serverProcess.stderr.pipe(logStream);
    
    let startupBuffer = '';
    const startupTimeout = setTimeout(() => {
      if (serverProcess && !startupBuffer.includes('Slither Arena Server')) {
        sendTelegramMessage('⚠️ Server may not have started correctly. Check /logs');
      }
    }, 10000);
    
    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      startupBuffer += msg;
      console.log('SERVER:', msg);
      
      if (msg.includes('Slither Arena Server')) {
        clearTimeout(startupTimeout);
        sendTelegramMessage('✅ <b>Server started successfully!</b>');
      }
      
      if (msg.includes('Error') || msg.includes('error')) {
        sendTelegramMessage(`⚠️ <b>Server Warning:</b>\n<code>${msg.substring(0, 500)}</code>`);
      }
    });
    
    serverProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      console.error('SERVER ERROR:', msg);
      sendTelegramMessage(`❌ <b>Server Error:</b>\n<code>${msg.substring(0, 500)}</code>`);
      logError('server_stderr', new Error(msg));
      
      // Auto-fix if possible
      if (!isShuttingDown) {
        autoFixError(msg);
      }
    });
    
    serverProcess.on('close', (code) => {
      clearTimeout(startupTimeout);
      const uptime = serverStartTime ? formatUptime((Date.now() - serverStartTime) / 1000) : 'N/A';
      console.log(`Server stopped (code: ${code}, uptime: ${uptime})`);
      
      serverProcess = null;
      serverStartTime = null;
      
      if (!isShuttingDown && code !== 0) {
        sendTelegramMessage(`🛑 <b>Server stopped unexpectedly</b>\nExit code: ${code}\nUptime: ${uptime}`);
        handleServerCrash();
      } else if (!isShuttingDown) {
        sendTelegramMessage(`🛑 <b>Server stopped</b>\nExit code: ${code}\nUptime: ${uptime}`);
      }
      
      isShuttingDown = false;
    });
    
    serverProcess.on('error', (err) => {
      console.error('Failed to start server:', err);
      logError('server_start', err);
      serverProcess = null;
      sendTelegramMessage(`❌ Failed to start: ${err.message}`);
    });
    
    startHealthCheck();
    
    return { success: true };
  } catch (e) {
    logError('start_server', e);
    serverProcess = null;
    return { success: false, error: e.message };
  }
}

// Stop Server safely
function stopServer(force = false) {
  if (!serverProcess) {
    return { success: false, error: 'Server not running' };
  }
  
  isShuttingDown = true;
  
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
  
  try {
    if (force) {
      serverProcess.kill('SIGKILL');
      serverProcess = null;
      isShuttingDown = false;
      return { success: true, forced: true };
    }
    
    serverProcess.kill('SIGTERM');
    
    // Force kill after 10 seconds if not stopped
    const forceKillTimeout = setTimeout(() => {
      if (serverProcess) {
        console.log('Force killing server...');
        serverProcess.kill('SIGKILL');
        serverProcess = null;
      }
      isShuttingDown = false;
    }, 10000);
    
    serverProcess.once('close', () => {
      clearTimeout(forceKillTimeout);
      isShuttingDown = false;
    });
    
    return { success: true };
  } catch (e) {
    logError('stop_server', e);
    isShuttingDown = false;
    return { success: false, error: e.message };
  }
}

// Restart Server safely
function restartServer() {
  if (isShuttingDown) {
    return { success: false, error: 'Already restarting, please wait' };
  }
  
  restartAttempts++;
  
  if (restartAttempts > 5) {
    return { success: false, error: 'Too many restart attempts. Use /forcestart if needed.' };
  }
  
  const wasRunning = serverProcess !== null;
  
  if (wasRunning) {
    const stopResult = stopServer();
    if (!stopResult.success) {
      return { success: false, error: `Stop failed: ${stopResult.error}` };
    }
  }
  
  // Wait for graceful shutdown
  setTimeout(() => {
    if (serverProcess) {
      console.log('Force stopping for restart...');
      stopServer(true);
    }
    
    setTimeout(() => {
      const startResult = startServer();
      if (!startResult.success) {
        sendTelegramMessage(`❌ Restart failed: ${startResult.error}`);
      }
    }, 2000);
  }, wasRunning ? 5000 : 0);
  
  return { success: true };
}

// Restart Bot (self-restart)
function restartBot() {
  sendTelegramMessage('🔄 <b>Restarting Dev Bot...</b>\n\nBot will be back online in 5 seconds.');
  
  setTimeout(() => {
    // Create restart script
    const restartScript = `
@echo off
timeout /t 2 /nobreak > nul
taskkill /F /PID ${process.pid} > nul 2>&1
timeout /t 1 /nobreak > nul
cd /d "${path.dirname(DEVBOT_FILE)}"
start /B node "${DEVBOT_FILE}"
exit
`;
    
    const scriptPath = path.join(BACKUP_DIR, 'restart_bot.bat');
    fs.writeFileSync(scriptPath, restartScript);
    
    // Execute restart script
    exec(`start /min cmd /c "${scriptPath}"`, (error) => {
      if (error) {
        console.error('Restart error:', error);
        sendTelegramMessage(`❌ Bot restart failed: ${error.message}`);
      }
    });
    
    // Exit current process
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  }, 1000);
}

// Check Server Status
function getServerStatus() {
  const uptime = serverStartTime ? (Date.now() - serverStartTime) / 1000 : 0;
  const lastStart = lastSuccessfulStart ? new Date(lastSuccessfulStart).toLocaleString() : 'Never';
  
  return {
    running: serverProcess !== null,
    pid: serverProcess ? serverProcess.pid : null,
    uptime: uptime,
    uptimeFormatted: serverProcess ? formatUptime(uptime) : 'N/A',
    startTime: lastStart,
    crashes: crashCount,
    healthy: serverProcess && (Date.now() - lastHealthCheck) < HEALTH_CHECK_INTERVAL * 2
  };
}

// Read File
function readServerFile(lines = 50) {
  try {
    const content = fs.readFileSync(SERVER_FILE, 'utf8');
    const allLines = content.split('\n');
    const displayLines = allLines.slice(0, lines);
    return {
      success: true,
      content: displayLines.join('\n'),
      totalLines: allLines.length,
      size: (content.length / 1024).toFixed(2) + ' KB'
    };
  } catch (e) {
    logError('read_file', e);
    return { success: false, error: e.message };
  }
}

// Write File
function writeServerFile(content) {
  try {
    createBackup(); // Always backup before writing
    fs.writeFileSync(SERVER_FILE, content, 'utf8');
    return { success: true };
  } catch (e) {
    logError('write_file', e);
    return { success: false, error: e.message };
  }
}

// Clear File Content
function clearServerFile() {
  try {
    createBackup();
    fs.writeFileSync(SERVER_FILE, '', 'utf8');
    return { success: true };
  } catch (e) {
    logError('clear_file', e);
    return { success: false, error: e.message };
  }
}

// Auto-fix Common Errors
function autoFixError(errorMsg) {
  if (isShuttingDown) return;
  
  let content;
  try {
    content = fs.readFileSync(SERVER_FILE, 'utf8');
  } catch (e) {
    return;
  }
  
  let fixed = false;
  let fixDescription = '';
  
  // Fix missing semicolons
  if (errorMsg.includes('Unexpected token') || errorMsg.includes('expected')) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.endsWith(';') && !line.endsWith('{') && 
          !line.endsWith('}') && !line.endsWith(',') && 
          !line.startsWith('//') && !line.startsWith('/*')) {
        lines[i] += ';';
        fixed = true;
      }
    }
    if (fixed) {
      content = lines.join('\n');
      fixDescription = 'Added missing semicolons';
    }
  }
  
  // Fix missing closing brackets
  if (errorMsg.includes('Unexpected end of input')) {
    const openBrackets = (content.match(/{/g) || []).length;
    const closeBrackets = (content.match(/}/g) || []).length;
    
    if (openBrackets > closeBrackets) {
      content += '\n' + '}'.repeat(openBrackets - closeBrackets);
      fixed = true;
      fixDescription = `Added ${openBrackets - closeBrackets} missing closing bracket(s)`;
    }
  }
  
  // Fix missing closing parentheses
  if (errorMsg.includes('missing') && errorMsg.includes(')')) {
    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    
    if (openParens > closeParens) {
      content += ')'.repeat(openParens - closeParens);
      fixed = true;
      fixDescription = `Added ${openParens - closeParens} missing parenthes(es)`;
    }
  }
  
  if (fixed) {
    createBackup();
    fs.writeFileSync(SERVER_FILE, content, 'utf8');
    sendTelegramMessage(`🔧 <b>Auto-fixed:</b> ${fixDescription}\n\nRestarting server...`);
    setTimeout(() => restartServer(), 2000);
  }
}

// Validate JavaScript Syntax
function validateSyntax(code) {
  try {
    new Function(code);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// Get Server Logs
function getServerLogs(lines = 50) {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return { success: false, error: 'No logs available' };
    }
    
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const allLines = content.split('\n').filter(l => l.trim());
    const lastLines = allLines.slice(-lines);
    
    return {
      success: true,
      logs: lastLines.join('\n')
    };
  } catch (e) {
    logError('get_logs', e);
    return { success: false, error: e.message };
  }
}

// Handle Telegram Commands
function handleCommand(message) {
  const chatId = message.chat.id;
  const text = message.text.trim();
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();
  
  // Authentication
  if (!authenticatedChatId) {
    if (text === ADMIN_PASSWORD) {
      authenticatedChatId = chatId;
      sendTelegramMessage('✅ <b>Authentication successful!</b>\n\n🛡️ Bot is secured and stable.\n\nType /help to see all commands.');
      console.log(`✅ Authenticated chat ID: ${chatId}`);
    } else {
      const authMsg = JSON.stringify({
        chat_id: chatId,
        text: '🔐 <b>Authentication Required</b>\n\nSend the admin password to use this bot.',
        parse_mode: 'HTML'
      });
      
      const req = https.request(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': authMsg.length
        }
      });
      req.write(authMsg);
      req.end();
    }
    return;
  }
  
  // Exit edit mode
  if (isEditMode && (command === '/done' || command === '/cancel')) {
    if (command === '/done' && editBuffer) {
      const validation = validateSyntax(editBuffer);
      if (!validation.valid) {
        sendTelegramMessage(`❌ <b>Syntax Error:</b>\n<code>${validation.error}</code>\n\nUse /cancel to discard or fix and use /done again.`);
        return;
      }
      
      const result = writeServerFile(editBuffer);
      if (result.success) {
        sendTelegramMessage('✅ File saved successfully!\n\n✔️ Backup created\n✔️ Syntax validated\n\nUse /start to run the server.');
      } else {
        sendTelegramMessage(`❌ Error saving: ${result.error}`);
      }
    } else {
      sendTelegramMessage('❌ Edit cancelled. No changes saved.');
    }
    isEditMode = false;
    editBuffer = '';
    return;
  }
  
  // Handle edit mode input
  if (isEditMode) {
    editBuffer += text + '\n';
    const lineCount = editBuffer.split('\n').length;
    sendTelegramMessage(`📝 <b>Edit Mode</b> (${lineCount} lines)\n\nContinue sending code or:\n/done - Save changes\n/cancel - Discard`);
    return;
  }
  
  // Commands
  switch (command) {
    case '/help':
      sendTelegramMessage(
        '📋 <b>Dev Bot Commands</b>\n\n' +
        '<b>🎮 Server Control (SAFE):</b>\n' +
        '/start - Start server (with validation)\n' +
        '/stop - Graceful shutdown (10s timeout)\n' +
        '/forcestop - Force kill immediately\n' +
        '/restart - Safe restart (stop + start)\n' +
        '/forcestart - Start without validation\n' +
        '/status - Detailed health status\n' +
        '/health - Quick health check\n\n' +
        '<b>📝 File Management:</b>\n' +
        '/read [lines] - View file (default 50)\n' +
        '/edit - Multi-line edit mode\n' +
        '/send [code] - Append code\n' +
        '/delete - Clear content (CONFIRM needed)\n' +
        '/validate - Check syntax\n\n' +
        '<b>💾 Backup & Restore:</b>\n' +
        '/backup - Manual backup\n' +
        '/backups - List all backups\n' +
        '/restore [file] - Restore backup\n\n' +
        '<b>📊 Monitoring:</b>\n' +
        '/logs [lines] - View logs (default 50)\n' +
        '/errors - View error log\n' +
        '/clear logs - Clear log file\n\n' +
        '<b>🔧 System:</b>\n' +
        '/info - File information\n' +
        '/botrestart - Restart this bot\n' +
        '/ping - Test bot connection'
      );
      break;
      
    case '/start':
      if (serverProcess) {
        sendTelegramMessage('⚠️ Server already running.\n\nUse /restart to restart or /status for details.');
      } else {
        sendTelegramMessage('🚀 <b>Starting server...</b>\n\n⏳ Validating syntax...');
        const result = startServer();
        if (!result.success) {
          sendTelegramMessage(`❌ Failed to start:\n<code>${result.error}</code>`);
        }
      }
      break;
      
    case '/forcestart':
      if (serverProcess) {
        sendTelegramMessage('⚠️ Server already running. Use /forcestop first.');
      } else {
        sendTelegramMessage('⚡ <b>Force starting server...</b>\n\n⚠️ Skipping validation');
        // Temporarily disable validation
        const originalValidate = validateSyntax;
        global.validateSyntax = () => ({ valid: true });
        const result = startServer();
        global.validateSyntax = originalValidate;
        
        if (!result.success) {
          sendTelegramMessage(`❌ Failed: ${result.error}`);
        }
      }
      break;
      
    case '/stop':
      const stopResult = stopServer();
      if (stopResult.success) {
        sendTelegramMessage('🛑 <b>Stopping server...</b>\n\n⏳ Graceful shutdown (10s timeout)');
      } else {
        sendTelegramMessage(`❌ ${stopResult.error}`);
      }
      break;
      
    case '/forcestop':
      const forceResult = stopServer(true);
      if (forceResult.success) {
        sendTelegramMessage('⚡ <b>Server force stopped!</b>');
      } else {
        sendTelegramMessage(`❌ ${forceResult.error}`);
      }
      break;
      
    case '/restart':
      if (isShuttingDown) {
        sendTelegramMessage('⏳ Restart already in progress...');
        return;
      }
      sendTelegramMessage('🔄 <b>Restarting server...</b>\n\n1️⃣ Stopping gracefully\n2️⃣ Waiting 5 seconds\n3️⃣ Starting fresh');
      const restartResult = restartServer();
      if (!restartResult.success) {
        sendTelegramMessage(`❌ ${restartResult.error}`);
      }
      break;
      
    case '/status':
      const status = getServerStatus();
      const statusIcon = status.running ? '🟢' : '🔴';
      const healthIcon = status.healthy ? '✅' : '⚠️';
      
      sendTelegramMessage(
        `${statusIcon} <b>Server Status</b>\n\n` +
        `Running: ${status.running ? 'Yes' : 'No'}\n` +
        `Health: ${healthIcon} ${status.healthy ? 'Healthy' : 'Warning'}\n` +
        `PID: ${status.pid || 'N/A'}\n` +
        `Uptime: ${status.uptimeFormatted}\n` +
        `Last Start: ${status.startTime}\n` +
        `Crashes: ${status.crashes}\n` +
        `Restart Attempts: ${restartAttempts}/5`
      );
      break;
      
    case '/health':
      const health = getServerStatus();
      if (health.running && health.healthy) {
        sendTelegramMessage(`✅ Server is <b>healthy</b>\n\nUptime: ${health.uptimeFormatted}`);
      } else if (health.running) {
        sendTelegramMessage(`⚠️ Server running but <b>unhealthy</b>\n\nConsider /restart`);
      } else {
        sendTelegramMessage(`🔴 Server is <b>offline</b>\n\nUse /start to launch`);
      }
      break;
      
    case '/ping':
      const pingStart = Date.now();
      sendTelegramMessage('🏓 Pong!');
      const pingTime = Date.now() - pingStart;
      setTimeout(() => {
        sendTelegramMessage(`⚡ Response time: ${pingTime}ms\n✅ Bot is responsive`);
      }, 100);
      break;
      
    case '/read':
      const lines = parseInt(parts[1]) || 50;
      const readResult = readServerFile(lines);
      if (readResult.success) {
        sendTelegramMessage(
          `📄 <b>server.js</b> (first ${lines} lines)\n` +
          `Total: ${readResult.totalLines} lines, ${readResult.size}\n\n` +
          `<code>${readResult.content.substring(0, 3500)}</code>`
        );
      } else {
        sendTelegramMessage(`❌ Error: ${readResult.error}`);
      }
      break;
      
    case '/edit':
      if (serverProcess) {
        sendTelegramMessage('⚠️ <b>SAFETY CHECK:</b> Stop the server first using /stop\n\nThis prevents file corruption.');
        return;
      }
      isEditMode = true;
      editBuffer = '';
      sendTelegramMessage(
        '📝 <b>Edit Mode Active</b>\n\n' +
        '✏️ Send your code line by line.\n' +
        '🔄 The bot will replace the entire file.\n' +
        '💾 Auto-backup will be created.\n\n' +
        '<b>Commands:</b>\n' +
        '/done - Validate & save changes\n' +
        '/cancel - Discard changes'
      );
      break;
      
    case '/send':
      if (serverProcess) {
        sendTelegramMessage('⚠️ <b>SAFETY CHECK:</b> Stop the server first using /stop');
        return;
      }
      const codeToAppend = text.substring(6);
      if (!codeToAppend) {
        sendTelegramMessage('❌ No code provided.\n\nUsage: /send [code]');
        return;
      }
      
      try {
        const current = fs.readFileSync(SERVER_FILE, 'utf8');
        const updated = current + '\n' + codeToAppend;
        const result = writeServerFile(updated);
        
        if (result.success) {
          sendTelegramMessage('✅ Code appended!\n\n💾 Backup created automatically');
        } else {
          sendTelegramMessage(`❌ Error: ${result.error}`);
        }
      } catch (e) {
        sendTelegramMessage(`❌ Error: ${e.message}`);
      }
      break;
      
    case '/delete':
      if (serverProcess) {
        sendTelegramMessage('⚠️ <b>SAFETY CHECK:</b> Stop the server first using /stop');
        return;
      }
      sendTelegramMessage(
        '⚠️ <b>CRITICAL WARNING</b>\n\n' +
        '🗑️ This will clear ALL content in server.js\n' +
        '💾 A backup will be created automatically\n' +
        '📋 You can restore using /backups\n\n' +
        '⚠️ Reply with "CONFIRM DELETE" to proceed\n' +
        '✅ Reply with anything else to cancel'
      );
      break;
      
    case '/validate':
      try {
        const content = fs.readFileSync(SERVER_FILE, 'utf8');
        const validation = validateSyntax(content);
        
        if (validation.valid) {
          sendTelegramMessage('✅ <b>Syntax is valid!</b>\n\n✔️ No errors detected\n✔️ Safe to start server');
        } else {
          sendTelegramMessage(`❌ <b>Syntax Error Found:</b>\n\n<code>${validation.error}</code>\n\n⚠️ Fix before starting server`);
        }
      } catch (e) {
        sendTelegramMessage(`❌ Error reading file: ${e.message}`);
      }
      break;
      
    case '/backup':
      const backupResult = createBackup();
      if (backupResult.success) {
        const filename = path.basename(backupResult.file);
        sendTelegramMessage(`✅ <b>Backup created successfully!</b>\n\n📦 <code>${filename}</code>\n\n💾 Stored in backups folder`);
      } else {
        sendTelegramMessage(`❌ Backup failed: ${backupResult.error}`);
      }
      break;
      
    case '/backups':
      const backups = listBackups();
      if (backups.length === 0) {
        sendTelegramMessage('📦 No backups found.\n\nUse /backup to create one.');
      } else {
        const list = backups.map((f, i) => `${i + 1}. ${f}`).join('\n');
        sendTelegramMessage(
          `📦 <b>Available Backups:</b>\n\n<code>${list}</code>\n\n` +
          `💡 Use /restore [filename] to restore\n` +
          `📊 Showing latest ${backups.length} backups`
        );
      }
      break;
      
    case '/restore':
      if (!parts[1]) {
        sendTelegramMessage('❌ Missing filename.\n\nUsage: /restore [filename]\n\nUse /backups to see available files.');
        return;
      }
      if (serverProcess) {
        sendTelegramMessage('⚠️ <b>SAFETY CHECK:</b> Stop the server first using /stop');
        return;
      }
      
      const restoreResult = restoreBackup(parts[1]);
      if (restoreResult.success) {
        sendTelegramMessage(
          `✅ <b>Restored successfully!</b>\n\n` +
          `📦 From: <code>${parts[1]}</code>\n` +
          `💾 Current version backed up\n\n` +
          `✔️ Use /start to run restored version`
        );
      } else {
        sendTelegramMessage(`❌ Restore failed: ${restoreResult.error}`);
      }
      break;
      
    case '/logs':
      const logLines = parseInt(parts[1]) || 50;
      const logsResult = getServerLogs(logLines);
      
      if (logsResult.success) {
        sendTelegramMessage(
          `📜 <b>Server Logs</b> (last ${logLines} lines)\n\n` +
          `<code>${logsResult.logs.substring(0, 3500)}</code>\n\n` +
          `💡 Use /logs [number] for more lines`
        );
      } else {
        sendTelegramMessage(`❌ ${logsResult.error}`);
      }
      break;
      
    case '/errors':
      if (errorBuffer.length === 0) {
        sendTelegramMessage('✅ No errors logged!\n\nServer is running clean.');
      } else {
        const recentErrors = errorBuffer.slice(-5).map(e => 
          `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.type}: ${e.message}`
        ).join('\n\n');
        sendTelegramMessage(
          `⚠️ <b>Recent Errors (last 5):</b>\n\n` +
          `<code>${recentErrors.substring(0, 3500)}</code>\n\n` +
          `📊 Total errors logged: ${errorBuffer.length}`
        );
      }
      break;
      
    case '/clear':
      if (parts[1] === 'logs') {
        try {
          fs.writeFileSync(LOG_FILE, '');
          sendTelegramMessage('✅ Logs cleared successfully!');
        } catch (e) {
          sendTelegramMessage(`❌ Error clearing logs: ${e.message}`);
        }
      } else {
        sendTelegramMessage('❌ Invalid usage.\n\nUse: /clear logs');
      }
      break;
      
    case '/info':
      const info = readServerFile(1);
      if (info.success) {
        const backupCount = listBackups().length;
        sendTelegramMessage(
          `📊 <b>File Information</b>\n\n` +
          `📄 File: server.js\n` +
          `📏 Lines: ${info.totalLines}\n` +
          `💾 Size: ${info.size}\n` +
          `📂 Location: ${SERVER_FILE}\n` +
          `📦 Backups: ${backupCount}\n` +
          `🔐 Bot uptime: ${formatUptime(process.uptime())}`
        );
      } else {
        sendTelegramMessage(`❌ Error: ${info.error}`);
      }
      break;
      
    case '/botrestart':
      sendTelegramMessage(
        '⚠️ <b>BOT RESTART REQUESTED</b>\n\n' +
        '🔄 This will restart the management bot (not the game server)\n' +
        '⏱️ Bot will be offline for ~5 seconds\n\n' +
        '✅ Reply with "CONFIRM BOTRESTART" to proceed'
      );
      break;
      
    default:
      if (text === 'CONFIRM DELETE') {
        const delResult = clearServerFile();
        if (delResult.success) {
          sendTelegramMessage('✅ File content cleared.\n\n💾 Backup created before deletion\n📋 Use /backups to restore if needed');
        } else {
          sendTelegramMessage(`❌ Error: ${delResult.error}`);
        }
      } else if (text === 'CONFIRM BOTRESTART') {
        restartBot();
      } else {
        sendTelegramMessage('❓ Unknown command.\n\nType /help for available commands.');
      }
  }
}

// Telegram Polling with reconnection
function pollUpdates(offset = 0) {
  https.get(`${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=30`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const updates = JSON.parse(data);
        if (updates.ok && updates.result.length > 0) {
          updates.result.forEach(update => {
            if (update.message && update.message.text) {
              try {
                handleCommand(update.message);
              } catch (e) {
                console.error('Command error:', e);
                logError('command_handler', e);
              }
            }
            offset = Math.max(offset, update.update_id + 1);
          });
        }
        setTimeout(() => pollUpdates(offset), 100);
      } catch (e) {
        console.error('Error parsing updates:', e);
        logError('polling', e);
        setTimeout(() => pollUpdates(offset), 2000);
      }
    });
  }).on('error', (e) => {
    console.error('Polling error:', e);
    logError('polling_connection', e);
    setTimeout(() => pollUpdates(offset), 5000);
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down bot gracefully...');
  sendTelegramMessage('🛑 <b>Bot shutting down</b>\n\nManual shutdown requested.');
  
  if (serverProcess) {
    console.log('Stopping game server...');
    stopServer();
  }
  
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
  }
  
  setTimeout(() => {
    console.log('✅ Shutdown complete');
    process.exit(0);
  }, 2000);
});

process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down...');
  sendTelegramMessage('🛑 <b>Bot shutting down</b>\n\nSystem shutdown requested.');
  
  if (serverProcess) {
    stopServer(true);
  }
  
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// Startup notification
setTimeout(() => {
  if (authenticatedChatId) {
    sendTelegramMessage(
      '🤖 <b>Dev Bot Started</b>\n\n' +
      `✅ Monitoring: server.js\n` +
      `🛡️ Safety features: Enabled\n` +
      `🔧 Auto-fix: Enabled\n` +
      `📊 Health checks: Every 1 minute\n\n` +
      `Type /status to check server`
    );
  }
}, 5000);

// Start bot
pollUpdates();
console.log('✅ Bot is running!');
console.log('💬 Send the password to your bot to authenticate.');
console.log('🛡️ Safety features active');
console.log('📊 Health monitoring enabled');
