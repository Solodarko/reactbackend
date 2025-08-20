@echo off
echo ========================================
echo 🚀 Starting School Project Backend Server
echo ========================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if npm packages are installed
if not exist node_modules (
    echo 📦 Installing npm packages...
    npm install
    if %errorlevel% neq 0 (
        echo ❌ Failed to install npm packages
        pause
        exit /b 1
    )
)

REM Kill any existing Node.js processes on port 5000
echo 🔍 Checking for existing server processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5000 ^| findstr LISTENING') do (
    echo 🛑 Stopping existing server process with PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)

REM Check if .env file exists
if not exist .env (
    echo ❌ .env file not found
    echo Please create a .env file with your environment variables
    pause
    exit /b 1
)

echo 🌐 Server will run on: http://localhost:5000
echo 🔗 Socket.IO test: http://localhost:5000/api/socketio-test  
echo 📚 Health check: http://localhost:5000/api/health
echo.
echo ⚡ Starting server...
echo.

REM Start the server
node server.js

REM If server exits, pause to show any error messages
echo.
echo 🛑 Server stopped
pause
