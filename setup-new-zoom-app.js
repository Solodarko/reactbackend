#!/usr/bin/env node

/**
 * Quick Setup Script for New Zoom Server-to-Server OAuth App
 * 
 * This script helps you:
 * 1. Test your new Zoom app credentials
 * 2. Verify all required scopes are working
 * 3. Update your .env file automatically
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Colors for console output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testZoomCredentials(accountId, clientId, clientSecret) {
    try {
        log('\n🔄 Testing Zoom credentials...', 'blue');
        
        // Get access token
        const tokenResponse = await axios.post('https://zoom.us/oauth/token', 
            `grant_type=account_credentials&account_id=${accountId}`,
            {
                headers: {
                    'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const accessToken = tokenResponse.data.access_token;
        log('✅ Access token obtained successfully!', 'green');

        // Test user info (basic scope)
        await axios.get('https://api.zoom.us/v2/users/me', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        log('✅ User info access: WORKING', 'green');

        // Test meeting list (main scope we need)
        await axios.get('https://api.zoom.us/v2/users/me/meetings', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        log('✅ Meeting list access: WORKING', 'green');

        // Test meeting creation
        const testMeeting = {
            topic: 'Test Meeting - Delete Me',
            type: 2,
            start_time: new Date(Date.now() + 3600000).toISOString(),
            duration: 30,
            settings: { host_video: false, participant_video: false }
        };

        const meetingResponse = await axios.post('https://api.zoom.us/v2/users/me/meetings', 
            testMeeting,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        log('✅ Meeting creation: WORKING', 'green');

        // Clean up test meeting
        await axios.delete(`https://api.zoom.us/v2/meetings/${meetingResponse.data.id}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        log('✅ Test meeting cleaned up', 'green');

        log('\n🎉 ALL TESTS PASSED! Your new Zoom app is ready to use.', 'green');
        return true;

    } catch (error) {
        log(`\n❌ Error testing credentials: ${error.response?.data?.message || error.message}`, 'red');
        if (error.response?.data?.code === 124) {
            log('💡 This means the required scopes are still missing from your app.', 'yellow');
        }
        return false;
    }
}

async function updateEnvFile(accountId, clientId, clientSecret) {
    const envPath = path.join(__dirname, '.env');
    
    try {
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }

        // Backup old credentials if they exist
        if (envContent.includes('ZOOM_ACCOUNT_ID=') && !envContent.includes('ZOOM_ACCOUNT_ID_OLD=')) {
            const oldAccountId = envContent.match(/ZOOM_ACCOUNT_ID=(.+)/)?.[1];
            const oldClientId = envContent.match(/ZOOM_CLIENT_ID=(.+)/)?.[1];
            const oldClientSecret = envContent.match(/ZOOM_CLIENT_SECRET=(.+)/)?.[1];
            
            if (oldAccountId && oldClientId && oldClientSecret) {
                envContent = `# OLD ZOOM CREDENTIALS (backup)\nZOOM_ACCOUNT_ID_OLD=${oldAccountId}\nZOOM_CLIENT_ID_OLD=${oldClientId}\nZOOM_CLIENT_SECRET_OLD=${oldClientSecret}\n\n` + envContent;
            }
        }

        // Update or add new credentials
        envContent = envContent.replace(/ZOOM_ACCOUNT_ID=.+/, `ZOOM_ACCOUNT_ID=${accountId}`);
        envContent = envContent.replace(/ZOOM_CLIENT_ID=.+/, `ZOOM_CLIENT_ID=${clientId}`);
        envContent = envContent.replace(/ZOOM_CLIENT_SECRET=.+/, `ZOOM_CLIENT_SECRET=${clientSecret}`);

        // Add if not present
        if (!envContent.includes('ZOOM_ACCOUNT_ID=')) {
            envContent += `\n# NEW ZOOM SERVER-TO-SERVER OAUTH CREDENTIALS\nZOOM_ACCOUNT_ID=${accountId}\nZOOM_CLIENT_ID=${clientId}\nZOOM_CLIENT_SECRET=${clientSecret}\n`;
        }

        fs.writeFileSync(envPath, envContent);
        log('✅ .env file updated successfully!', 'green');
        return true;
    } catch (error) {
        log(`❌ Error updating .env file: ${error.message}`, 'red');
        return false;
    }
}

async function main() {
    log('🚀 Zoom Server-to-Server OAuth App Setup', 'bold');
    log('==========================================\n');

    // Get credentials from command line or prompt
    const args = process.argv.slice(2);
    
    if (args.length !== 3) {
        log('Usage: node setup-new-zoom-app.js <ACCOUNT_ID> <CLIENT_ID> <CLIENT_SECRET>', 'yellow');
        log('\nExample:', 'blue');
        log('node setup-new-zoom-app.js ABC123xyz 1234567890 abcdef123456', 'blue');
        log('\n💡 Get these credentials from your Server-to-Server OAuth app on marketplace.zoom.us', 'yellow');
        process.exit(1);
    }

    const [accountId, clientId, clientSecret] = args;

    log(`Testing credentials for Account ID: ${accountId.substring(0, 6)}...`, 'blue');

    // Test the credentials
    const testsPassed = await testZoomCredentials(accountId, clientId, clientSecret);
    
    if (testsPassed) {
        // Update .env file
        log('\n🔄 Updating .env file...', 'blue');
        await updateEnvFile(accountId, clientId, clientSecret);
        
        log('\n🎉 Setup Complete!', 'green');
        log('Next steps:', 'blue');
        log('1. Restart your backend server: npm start', 'yellow');
        log('2. Test your endpoints using the existing test routes', 'yellow');
        log('3. Your Zoom integration should now work perfectly!', 'yellow');
    } else {
        log('\n❌ Setup failed. Please check your credentials and scopes.', 'red');
        log('Refer to CREATE_NEW_ZOOM_APP.md for detailed instructions.', 'yellow');
        process.exit(1);
    }
}

// Run the setup
if (require.main === module) {
    main().catch(error => {
        log(`❌ Unexpected error: ${error.message}`, 'red');
        process.exit(1);
    });
}

module.exports = { testZoomCredentials, updateEnvFile };
