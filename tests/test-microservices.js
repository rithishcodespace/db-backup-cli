#!/usr/bin/env node
import chalk from 'chalk';
import axios from 'axios';

const SERVICES = {
  gateway: 'http://localhost:3000/health',
  orchestrator: 'http://localhost:3001/health',
  postgres: 'http://localhost:3010/health',
  mysql: 'http://localhost:3011/health',
  mongodb: 'http://localhost:3012/health',
  sqlite: 'http://localhost:3013/health'
};

async function testServices() {
  console.log(chalk.cyan.bold('\n🔍 Testing Microservices Health\n'));
  
  let allHealthy = true;
  
  for (const [name, url] of Object.entries(SERVICES)) {
    try {
      const response = await axios.get(url, { timeout: 5000 });
      if (response.data.status === 'healthy') {
        console.log(chalk.green(`✓ ${name}: Healthy (uptime: ${response.data.uptime?.toFixed(2)}s)`));
      } else {
        console.log(chalk.yellow(`⚠ ${name}: ${response.data.status}`));
        allHealthy = false;
      }
    } catch (error) {
      console.log(chalk.red(`✗ ${name}: Unhealthy - ${error.message}`));
      allHealthy = false;
    }
  }
  
  console.log(chalk.bold.cyan('\n📡 Testing Backup Flow\n'));
  
  try {
    // Test backup request
    const backupRequest = {
      dbConfig: {
        type: 'postgresql',
        host: 'localhost',
        port: 5432,
        username: 'rithish',
        password: 'Rithish@2006',
        database: 'testdb'
      },
      backupType: 'full',
      options: {
        compress: true
      }
    };
    
    const response = await axios.post('http://localhost:3000/api/backup', backupRequest);
    
    if (response.data.success) {
      console.log(chalk.green(`✓ Backup test successful`));
      console.log(chalk.dim(`  Backup ID: ${response.data.backupId}`));
      console.log(chalk.dim(`  Duration: ${response.data.duration?.toFixed(2)}s`));
    } else {
      console.log(chalk.red(`✗ Backup test failed: ${response.data.error}`));
    }
  } catch (error) {
    console.log(chalk.red(`✗ Backup test error: ${error.message}`));
  }
  
  console.log(chalk.bold.green('\n✅ Microservices test completed\n'));
}

testServices().catch(console.error);