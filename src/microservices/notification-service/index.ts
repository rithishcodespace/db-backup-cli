import express from 'express';
import { prisma } from "../../lib/prisma";
import { IncomingWebhook } from '@slack/webhook';
import nodemailer from 'nodemailer';
import { createModuleLogger } from '../../logger';

const app = express();
app.use(express.json());

const log = createModuleLogger('notification-service');

const SERVICE_PORT = process.env.NOTIFICATION_SERVICE_PORT || 3040;
const SERVICE_NAME = 'notification-service';
const startTime = Date.now();

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: 'healthy',
    version: '1.0.0',
    uptime: (Date.now() - startTime) / 1000
  });
});

// Send notification
app.post('/api/notify', async (req, res) => {
  const { type, backupId, config, message } = req.body;
  
  log.info('Received notification request', { type, backupId });
  
  try {
    const result = await sendNotification(type, backupId, config, message);
    res.json({
      success: true,
      result
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Notification failed', { error: errorMessage });
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

async function sendNotification(type: string, backupId: string, config: any, message: any) {
  let result;
  
  switch (type) {
    case 'slack':
      result = await sendSlackNotification(config, message);
      break;
    case 'email':
      result = await sendEmailNotification(config, message);
      break;
    default:
      throw new Error(`Unsupported notification type: ${type}`);
  }
  
  // Record notification
  await prisma.notification.create({
    data: {
      backupJobId: backupId || null,
      type: type,
      status: 'sent',
      recipient: config.recipient || config.channel || config.to || config.webhookUrl,
      subject: message.subject,
      message: message.text,
      sentAt: new Date()
    }
  });
  
  return result;
}

async function sendSlackNotification(config: any, message: any) {
  try {
    const webhookUrl = config.webhookUrl || config.webhook;
    
    if (!webhookUrl) {
      throw new Error('Slack webhook URL is required');
    }
    
    const webhook = new IncomingWebhook(webhookUrl);
    
    await webhook.send({
      text: message.text,
      attachments: message.attachments || [],
      ...(message.blocks && { blocks: message.blocks })
    });
    
    log.info('Slack notification sent');
    return { success: true, platform: 'slack' };
  } catch (error) {
    log.error('Slack notification failed', { error });
    throw error;
  }
}

async function sendEmailNotification(config: any, message: any) {
  try {
    // Use provided config or fallback to environment variables
    const smtpConfig = {
      host: config.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(config.smtpPort || process.env.SMTP_PORT || '587'),
      secure: config.smtpSecure || process.env.SMTP_SECURE === 'true' || false,
      auth: {
        user: config.username || config.smtpUser || process.env.SMTP_USER,
        pass: config.password || config.smtpPassword || process.env.SMTP_PASS,
      },
    };
    
    if (!smtpConfig.auth.user || !smtpConfig.auth.pass) {
      throw new Error('SMTP credentials are required. Please configure email notification.');
    }
    
    const transporter = nodemailer.createTransport(smtpConfig);
    
    const mailOptions = {
      from: config.from || process.env.SMTP_FROM || smtpConfig.auth.user,
      to: config.to || process.env.SMTP_TO,
      subject: message.subject || 'DB Backup Notification',
      text: message.text,
      html: message.html || message.text?.replace(/\n/g, '<br>'),
    };
    
    const info = await transporter.sendMail(mailOptions);
    log.info('Email notification sent', { 
      to: mailOptions.to, 
      messageId: info.messageId 
    });
    
    return { success: true, platform: 'email', messageId: info.messageId };
  } catch (error) {
    log.error('Email notification failed', { error });
    throw error;
  }
}

// Test Slack endpoint (for CLI testing)
app.post('/api/notify/test/slack', async (req, res) => {
  const { webhookUrl } = req.body;
  
  try {
    const url = webhookUrl || process.env.SLACK_WEBHOOK_URL;
    
    if (!url) {
      throw new Error('Slack webhook URL is required');
    }
    
    const webhook = new IncomingWebhook(url);
    await webhook.send({
      text: '✅ DB Backup CLI - Test Notification',
      attachments: [
        {
          color: '#36a64f',
          title: '✅ Test Notification',
          text: 'Your Slack integration is working correctly.',
          fields: [
            {
              title: 'Time',
              value: new Date().toISOString(),
              short: true
            },
            {
              title: 'Service',
              value: 'DB Backup CLI',
              short: true
            }
          ],
          footer: 'DB Backup CLI',
          ts: Math.floor(Date.now() / 1000).toString()
        }
      ]
    });
    
    res.json({ success: true, message: 'Test Slack notification sent' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// Test Email endpoint (for CLI testing)
app.post('/api/notify/test/email', async (req, res) => {
  const { to } = req.body;
  
  try {
    const smtpConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    };
    
    if (!smtpConfig.auth.user || !smtpConfig.auth.pass) {
      throw new Error('SMTP credentials not configured in environment');
    }
    
    const transporter = nodemailer.createTransport(smtpConfig);
    
    const mailOptions = {
      from: process.env.SMTP_FROM || smtpConfig.auth.user,
      to: to || process.env.SMTP_TO,
      subject: 'DB Backup CLI - Test Email',
      text: 'This is a test email from DB Backup CLI.\n\nIf you received this, your email configuration is working correctly!',
      html: '<h2>DB Backup CLI - Test Email</h2><p>If you received this, your email configuration is working correctly!</p>',
    };
    
    const info = await transporter.sendMail(mailOptions);
    
    res.json({
      success: true,
      message: 'Test email sent',
      messageId: info.messageId,
      to: mailOptions.to
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

app.listen(SERVICE_PORT, () => {
  log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;