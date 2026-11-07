#!/usr/bin/env bash
# The existing TicketPlus Certbot container renews this certificate.
# Reload its Nginx only after the certificate changes and configuration validates.
set -euo pipefail
certificate=/var/www/TicketPlus-dashboard/nginx/certbot/conf/live/stemora.mydjplus.com/fullchain.pem
loaded_hash=/var/www/stemora/deploy-logs/tls.loaded.sha256
current_hash=$(sha256sum "$certificate" | cut -d ' ' -f 1)
if [[ -r "$loaded_hash" ]] && [[ $(cat "$loaded_hash") == "$current_hash" ]]; then
  exit 0
fi
docker exec ticketsplus-nginx nginx -t
docker exec ticketsplus-nginx nginx -s reload
umask 077
printf '%s\n' "$current_hash" > "$loaded_hash"
