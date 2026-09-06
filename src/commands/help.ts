import chalk from 'chalk';
import * as packageJson from '../../package.json';

export function showHelp(): void {
  console.log(`
    ${chalk.bold.cyan('Database Backup CLI Utility')} v${packageJson.version}

    ${chalk.bold('Usage:')}
    db-backup <command> [options]

    ${chalk.bold('Commands:')}
    ${chalk.green('init')}         Initialize project setup and onboarding wizard
    ${chalk.green('config check')}  Verify configuration health and reachability
    ${chalk.green('dashboard')}     Open companion web monitoring dashboard
    ${chalk.green('connect')}       Connect to a database and test connection
    ${chalk.green('backup')}        Perform a database backup
    ${chalk.green('restore')}       Restore a database from backup
    ${chalk.green('list')}          List available backups
    ${chalk.green('schedule')}      Schedule automated backups
    ${chalk.green('infra')}         Inspect and manage runtime infrastructure
    ${chalk.green('doctor')}        Diagnose environment, configuration, and infrastructure health
    ${chalk.green('help')}          Show this help message

    ${chalk.bold('Global Options:')}
    -c, --config <path>   Path to config file
    -v, --verbose         Enable verbose logging
    --no-color            Disable colored output
    -h, --help            Display help for command

    ${chalk.bold('Examples:')}
    ${chalk.dim('# Connect to a PostgreSQL database')}
    db-backup connect --type postgresql --host localhost --user admin --db mydb

    ${chalk.dim('# Connect to MySQL')}
    db-backup connect --type mysql --host localhost --port 3306 --user root --db test

    ${chalk.dim('# Perform a full backup')}
    db-backup backup --type full --compress

    ${chalk.dim('# Perform backup with custom name')}
    db-backup backup --name "myapp_backup_$(date +%Y%m%d)"

    ${chalk.bold('Documentation:')}
    For more information, visit: ${chalk.underline('https://github.com/your-repo/db-backup-cli')}
`);
}