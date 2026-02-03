interface BookingEmailData {
  customerName: string
  customerEmail: string
  serviceName: string
  staffName?: string
  businessName: string
  startsAt: Date
  endsAt: Date
  confirmationToken: string
  notes?: string
  price?: number
  currency?: string
}

function formatDate(date: Date, timezone = 'Europe/Berlin'): string {
  return date.toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: timezone,
  })
}

function formatTime(date: Date, timezone = 'Europe/Berlin'): string {
  return date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
}

function formatPrice(price: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
  }).format(price)
}

const baseStyles = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { background: #3B82F6; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
  .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }
  .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
  .detail-row { display: flex; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
  .detail-label { font-weight: 600; width: 120px; color: #6b7280; }
  .detail-value { color: #111827; }
  .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
  .button { display: inline-block; background: #3B82F6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
  .button-secondary { background: #6b7280; }
  .highlight { background: #fef3c7; padding: 15px; border-radius: 6px; border-left: 4px solid #f59e0b; margin: 20px 0; }
`

export function bookingConfirmationEmail(data: BookingEmailData): { subject: string; html: string; text: string } {
  const subject = `Buchungsbestätigung - ${data.serviceName} am ${formatDate(data.startsAt)}`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header">
    <h1>Buchung eingegangen</h1>
  </div>
  <div class="content">
    <p>Hallo ${data.customerName},</p>
    <p>vielen Dank für Ihre Buchung bei <strong>${data.businessName}</strong>. Ihre Anfrage wurde erfolgreich übermittelt.</p>

    <div class="details">
      <h3 style="margin-top: 0;">Buchungsdetails</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280; width: 140px;">Service:</td>
          <td style="padding: 8px 0; font-weight: 600;">${data.serviceName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Datum:</td>
          <td style="padding: 8px 0; font-weight: 600;">${formatDate(data.startsAt)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Uhrzeit:</td>
          <td style="padding: 8px 0; font-weight: 600;">${formatTime(data.startsAt)} - ${formatTime(data.endsAt)} Uhr</td>
        </tr>
        ${data.staffName ? `
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Mitarbeiter:</td>
          <td style="padding: 8px 0; font-weight: 600;">${data.staffName}</td>
        </tr>
        ` : ''}
        ${data.price ? `
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Preis:</td>
          <td style="padding: 8px 0; font-weight: 600;">${formatPrice(data.price, data.currency)}</td>
        </tr>
        ` : ''}
        ${data.notes ? `
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Anmerkungen:</td>
          <td style="padding: 8px 0;">${data.notes}</td>
        </tr>
        ` : ''}
      </table>
    </div>

    <div class="highlight">
      <strong>Hinweis:</strong> Sie erhalten eine weitere E-Mail, sobald Ihre Buchung bestätigt wurde.
    </div>

    <p>Bei Fragen können Sie diese E-Mail beantworten oder uns direkt kontaktieren.</p>

    <p>Mit freundlichen Grüßen,<br><strong>${data.businessName}</strong></p>
  </div>
  <div class="footer">
    <p>Buchungsnummer: ${data.confirmationToken}</p>
    <p>Powered by Freiplatz</p>
  </div>
</body>
</html>
`

  const text = `
Buchung eingegangen

Hallo ${data.customerName},

vielen Dank für Ihre Buchung bei ${data.businessName}. Ihre Anfrage wurde erfolgreich übermittelt.

BUCHUNGSDETAILS
---------------
Service: ${data.serviceName}
Datum: ${formatDate(data.startsAt)}
Uhrzeit: ${formatTime(data.startsAt)} - ${formatTime(data.endsAt)} Uhr
${data.staffName ? `Mitarbeiter: ${data.staffName}\n` : ''}${data.price ? `Preis: ${formatPrice(data.price, data.currency)}\n` : ''}${data.notes ? `Anmerkungen: ${data.notes}\n` : ''}
Buchungsnummer: ${data.confirmationToken}

Sie erhalten eine weitere E-Mail, sobald Ihre Buchung bestätigt wurde.

Mit freundlichen Grüßen,
${data.businessName}
`

  return { subject, html, text }
}

export function bookingNotificationEmail(data: BookingEmailData & { customerPhone?: string }): { subject: string; html: string; text: string } {
  const subject = `Neue Buchung - ${data.serviceName} am ${formatDate(data.startsAt)}`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header" style="background: #10b981;">
    <h1>Neue Buchungsanfrage</h1>
  </div>
  <div class="content">
    <p>Eine neue Buchungsanfrage ist eingegangen:</p>

    <div class="details">
      <h3 style="margin-top: 0;">Kundeninformationen</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280; width: 140px;">Name:</td>
          <td style="padding: 8px 0; font-weight: 600;">${data.customerName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">E-Mail:</td>
          <td style="padding: 8px 0;"><a href="mailto:${data.customerEmail}">${data.customerEmail}</a></td>
        </tr>
        ${data.customerPhone ? `
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Telefon:</td>
          <td style="padding: 8px 0;"><a href="tel:${data.customerPhone}">${data.customerPhone}</a></td>
        </tr>
        ` : ''}
      </table>
    </div>

    <div class="details">
      <h3 style="margin-top: 0;">Termindetails</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280; width: 140px;">Service:</td>
          <td style="padding: 8px 0; font-weight: 600;">${data.serviceName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Datum:</td>
          <td style="padding: 8px 0; font-weight: 600;">${formatDate(data.startsAt)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Uhrzeit:</td>
          <td style="padding: 8px 0; font-weight: 600;">${formatTime(data.startsAt)} - ${formatTime(data.endsAt)} Uhr</td>
        </tr>
        ${data.staffName ? `
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Mitarbeiter:</td>
          <td style="padding: 8px 0; font-weight: 600;">${data.staffName}</td>
        </tr>
        ` : ''}
        ${data.price ? `
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Preis:</td>
          <td style="padding: 8px 0; font-weight: 600;">${formatPrice(data.price, data.currency)}</td>
        </tr>
        ` : ''}
        ${data.notes ? `
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Anmerkungen:</td>
          <td style="padding: 8px 0;">${data.notes}</td>
        </tr>
        ` : ''}
      </table>
    </div>

    <p style="text-align: center;">
      Bitte überprüfen Sie die Anfrage und bestätigen oder lehnen Sie den Termin ab.
    </p>
  </div>
  <div class="footer">
    <p>Buchungsnummer: ${data.confirmationToken}</p>
  </div>
</body>
</html>
`

  const text = `
Neue Buchungsanfrage

Eine neue Buchungsanfrage ist eingegangen:

KUNDENINFORMATIONEN
-------------------
Name: ${data.customerName}
E-Mail: ${data.customerEmail}
${data.customerPhone ? `Telefon: ${data.customerPhone}\n` : ''}
TERMINDETAILS
-------------
Service: ${data.serviceName}
Datum: ${formatDate(data.startsAt)}
Uhrzeit: ${formatTime(data.startsAt)} - ${formatTime(data.endsAt)} Uhr
${data.staffName ? `Mitarbeiter: ${data.staffName}\n` : ''}${data.price ? `Preis: ${formatPrice(data.price, data.currency)}\n` : ''}${data.notes ? `Anmerkungen: ${data.notes}\n` : ''}
Buchungsnummer: ${data.confirmationToken}

Bitte überprüfen Sie die Anfrage und bestätigen oder lehnen Sie den Termin ab.
`

  return { subject, html, text }
}

export function bookingCancellationEmail(data: BookingEmailData & { reason?: string }): { subject: string; html: string; text: string } {
  const subject = `Buchung storniert - ${data.serviceName} am ${formatDate(data.startsAt)}`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header" style="background: #ef4444;">
    <h1>Buchung storniert</h1>
  </div>
  <div class="content">
    <p>Hallo ${data.customerName},</p>
    <p>Ihre Buchung bei <strong>${data.businessName}</strong> wurde storniert.</p>

    <div class="details">
      <h3 style="margin-top: 0;">Stornierte Buchung</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280; width: 140px;">Service:</td>
          <td style="padding: 8px 0;">${data.serviceName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Datum:</td>
          <td style="padding: 8px 0;">${formatDate(data.startsAt)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Uhrzeit:</td>
          <td style="padding: 8px 0;">${formatTime(data.startsAt)} - ${formatTime(data.endsAt)} Uhr</td>
        </tr>
        ${data.reason ? `
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Grund:</td>
          <td style="padding: 8px 0;">${data.reason}</td>
        </tr>
        ` : ''}
      </table>
    </div>

    <p>Wenn Sie einen neuen Termin buchen möchten, besuchen Sie bitte unsere Buchungsseite.</p>

    <p>Mit freundlichen Grüßen,<br><strong>${data.businessName}</strong></p>
  </div>
  <div class="footer">
    <p>Buchungsnummer: ${data.confirmationToken}</p>
    <p>Powered by Freiplatz</p>
  </div>
</body>
</html>
`

  const text = `
Buchung storniert

Hallo ${data.customerName},

Ihre Buchung bei ${data.businessName} wurde storniert.

STORNIERTE BUCHUNG
------------------
Service: ${data.serviceName}
Datum: ${formatDate(data.startsAt)}
Uhrzeit: ${formatTime(data.startsAt)} - ${formatTime(data.endsAt)} Uhr
${data.reason ? `Grund: ${data.reason}\n` : ''}
Buchungsnummer: ${data.confirmationToken}

Wenn Sie einen neuen Termin buchen möchten, besuchen Sie bitte unsere Buchungsseite.

Mit freundlichen Grüßen,
${data.businessName}
`

  return { subject, html, text }
}

export function bookingReminderEmail(data: BookingEmailData): { subject: string; html: string; text: string } {
  const subject = `Terminerinnerung - ${data.serviceName} morgen um ${formatTime(data.startsAt)} Uhr`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${baseStyles}</style>
</head>
<body>
  <div class="header" style="background: #f59e0b;">
    <h1>Terminerinnerung</h1>
  </div>
  <div class="content">
    <p>Hallo ${data.customerName},</p>
    <p>dies ist eine freundliche Erinnerung an Ihren bevorstehenden Termin bei <strong>${data.businessName}</strong>.</p>

    <div class="details">
      <h3 style="margin-top: 0;">Ihr Termin</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280; width: 140px;">Service:</td>
          <td style="padding: 8px 0; font-weight: 600;">${data.serviceName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Datum:</td>
          <td style="padding: 8px 0; font-weight: 600;">${formatDate(data.startsAt)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Uhrzeit:</td>
          <td style="padding: 8px 0; font-weight: 600;">${formatTime(data.startsAt)} - ${formatTime(data.endsAt)} Uhr</td>
        </tr>
        ${data.staffName ? `
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Mitarbeiter:</td>
          <td style="padding: 8px 0; font-weight: 600;">${data.staffName}</td>
        </tr>
        ` : ''}
      </table>
    </div>

    <div class="highlight">
      <strong>Wichtig:</strong> Falls Sie den Termin nicht wahrnehmen können, bitten wir um rechtzeitige Absage.
    </div>

    <p>Wir freuen uns auf Sie!</p>

    <p>Mit freundlichen Grüßen,<br><strong>${data.businessName}</strong></p>
  </div>
  <div class="footer">
    <p>Buchungsnummer: ${data.confirmationToken}</p>
    <p>Powered by Freiplatz</p>
  </div>
</body>
</html>
`

  const text = `
Terminerinnerung

Hallo ${data.customerName},

dies ist eine freundliche Erinnerung an Ihren bevorstehenden Termin bei ${data.businessName}.

IHR TERMIN
----------
Service: ${data.serviceName}
Datum: ${formatDate(data.startsAt)}
Uhrzeit: ${formatTime(data.startsAt)} - ${formatTime(data.endsAt)} Uhr
${data.staffName ? `Mitarbeiter: ${data.staffName}\n` : ''}
Buchungsnummer: ${data.confirmationToken}

Falls Sie den Termin nicht wahrnehmen können, bitten wir um rechtzeitige Absage.

Wir freuen uns auf Sie!

Mit freundlichen Grüßen,
${data.businessName}
`

  return { subject, html, text }
}
