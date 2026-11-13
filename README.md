# Pliego Editions

A digital print shop with a shopping bag and a trial membership. Checkout uses a fictional card and never processes charges.

## Deploy on Render

Create a Node.js web service connected to this repository. Set the build command to `npm install` and the start command to `npm start`.

Set the following private environment variables before deploying.

| Variable | Value |
| --- | --- |
| RESEND_API_KEY | A sending key from your Resend account |
| EMAIL_FROM | A sender address on a domain verified with Resend |

When a visitor selects **Activate**, the server asks Resend to send a confirmation to the submitted email address. Once Resend accepts the email, the store records the membership in that browser. To check delivery, activate with your own address and check your inbox or the delivery event in Resend.

## Run locally

Use Node.js 22 or later. Export the two variables above and run `npm start`. The default port is 3000. Render assigns the port through `PORT`.

## Ordering prints

Checkout requires an active membership and uses the default demonstration Visa ending in 4242. The server calculates the order total and signs a download link for the selected artwork. Set a stable `MEMBER_SECRET` in Render to keep confirmation links valid when rotating your email service key.
