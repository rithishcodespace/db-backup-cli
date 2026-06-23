import express from 'express';
import {prisma} from "../../lib/prisma"
import { IncomingWebhook } from '@slack/webhook'; // wrapper of slack sdk for easier webhook usage
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
      backupJobId: backupId,
      type: type,
      status: 'sent',
      recipient: config.recipient || config.channel,
      subject: message.subject,
      message: message.text,
      sentAt: new Date()
    }
  });
  
  return result;
}

async function sendSlackNotification(config: any, message: any) {
  try {
    const webhook = new IncomingWebhook(config.webhookUrl);
    
    await webhook.send({ // calls webhook url with payload, then slack will handle the rest
      text: message.text,
      attachments: message.attachments || [],
      ...(message.blocks && { blocks: message.blocks })
    });
    
    log.info('Slack notification sent', { channel: config.channel });
    return { success: true, platform: 'slack' };
  } catch (error) {
    log.error('Slack notification failed', { error });
    throw error;
  }
}

async function sendEmailNotification(config: any, message: any) {
  try {
    const transporter = nodemailer.createTransport({
      host: config.smtpHost || 'smtp.gmail.com', // send mail through gmail by default, can be overridden by config
      port: config.smtpPort || 587,
      secure: config.smtpSecure || false, // ssl

      auth: { // credentials for email account, required for authentication with smtp server (send email through this account)
        user: config.username,
        pass: config.password,
      },
    });
    
    const mailOptions = {
      from: config.from,
      to: config.to,
      subject: message.subject,
      text: message.text,
      html: message.html || message.text,
    };
    
    const info = await transporter.sendMail(mailOptions);
    log.info('Email notification sent', { to: config.to, messageId: info.messageId });
    
    return { success: true, platform: 'email', messageId: info.messageId };
  } catch (error) {
    log.error('Email notification failed', { error });
    throw error;
  }
}

app.listen(SERVICE_PORT, () => {
  log.info(`${SERVICE_NAME} listening on port ${SERVICE_PORT}`);
});

export default app;