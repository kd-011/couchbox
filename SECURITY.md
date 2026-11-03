# Security policy

## Reporting a vulnerability

Please do not open a public issue.

Use GitHub's private vulnerability reporting: on the repository, open the Security tab and choose "Report a vulnerability" (https://github.com/kd-011/party-games/security/advisories/new). Say what you found and how to reproduce it, and leave out live credentials and real player names.

This is a one-person project, so there is no promised response time. Every report is read. A confirmed problem is fixed, then disclosed in the advisory.

## Supported versions

Only `main`.

## What is in scope

- A client seeing something it should not, such as another player's role or the secret word
- Taking host controls, or acting as another player, without their room token
- Script injection through names, packs or AI-made content
- Getting past the rate limits or the daily spend cap on AI packs
- Reading files outside `public/` through the server
- Secrets written to logs or responses

## What is not

- Problems that need the Node port exposed directly to the internet, because the `CF-Connecting-IP` header can then be spoofed (the README says not to do this)
- Findings in OpenRouter, Kokoro or any other third-party service
- Your own deployment's proxy or firewall configuration
