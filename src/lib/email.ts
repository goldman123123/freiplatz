import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true, // SSL/TLS on port 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false, // Allow self-signed/mismatched certs (shared hosting)
  },
})

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail(options: SendEmailOptions) {
  console.log('[Email] Attempting to send email to:', options.to)
  console.log('[Email] SMTP_HOST:', process.env.SMTP_HOST ? 'SET' : 'NOT SET')
  console.log('[Email] SMTP_USER:', process.env.SMTP_USER ? 'SET' : 'NOT SET')

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn('[Email] Email not configured - skipping email send')
    return null
  }

  try {
    const result = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      ...options,
    })
    console.log('[Email] Email sent successfully, messageId:', result.messageId)
    return result
  } catch (error) {
    console.error('[Email] Failed to send email:', error)
    throw error
  }
}
