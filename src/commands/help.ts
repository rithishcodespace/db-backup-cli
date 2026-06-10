import chalk from 'chalk';
import * as packageJson from '../../package.json';

export function showHelp(): void {
  console.log(`
    ${chalk.bold.cyan('Database Backup CLI Utility')} v${packageJson.version}

    ${chalk.bold('Usage:')}
    db-backup <command> [options]

    ${chalk.bold('Commands:')}
    ${chalk.green('connect')}     Connect to a database and test connection
    ${chalk.green('backup')}      Perform a database backup
    ${chalk.green('restore')}     Restore a database from backup (coming soon)
    ${chalk.green('list')}        List available backups (coming soon)
    ${chalk.green('schedule')}    Schedule automated backups (coming soon)
    ${chalk.green('config')}      Manage configuration (coming soon)
    ${chalk.green('help')}        Show this help message

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