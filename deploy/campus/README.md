# Campus deployment — quiz service

TLS terminates at the campus Nginx proxy in front of a loopback-only Node
listener (`127.0.0.1:7300`). P-3 supplies the actual campus hostname,
certificate, and database facts below; nothing in this repository fills
them in. Record every fact this procedure asks for in the D-10 evidence
file (`services/quiz-service/test/operations/evidence/d10-<YYYYMMDD>.md`);
a missing fact stops the gate.

## Ordered staging procedure

1. **Record facts.** Hostname, public origin, certificate paths/expiry,
   PostgreSQL host/version, Node/pnpm paths, service user uid/gid, backup
   directory, and firewall owner. Write these into the D-10 evidence
   template before continuing.

2. **Build.**

   ```bash
   pnpm install --frozen-lockfile
   pnpm --filter @eduscope/shared build
   pnpm --filter @eduscope/quiz-service build
   pnpm --filter @eduscope/quiz build
   test -f apps/quiz/.next/BUILD_ID
   ```

3. **Database and config.** Create the database/role by the campus DBA
   procedure. Write `/etc/eduscope/quiz-service.env` (copied from
   `quiz-service.env.example`, secrets filled in) with mode `0600`:

   ```bash
   install -m 0600 /dev/null /etc/eduscope/quiz-service.env
   # fill QUIZ_SERVICE_* and DATABASE_URL, then:
   node deploy/campus/render-config.mjs \
     --input deploy/campus/nginx-quiz.conf \
     --output /etc/nginx/sites-available/eduscope-quiz.conf \
     --host "$QUIZ_PUBLIC_HOST" \
     --certificate "$TLS_CERTIFICATE" \
     --certificate-key "$TLS_CERTIFICATE_KEY"
   nginx -t
   pnpm --filter @eduscope/quiz-service migrate
   pnpm --filter @eduscope/quiz-service migrate
   ```

4. **Provision the device.** Generate the raw bearer out-of-band, then:

   ```bash
   printf '%s' "$DEVICE_BEARER" | \
     pnpm --filter @eduscope/quiz-service provision:device \
       --device-id "$DEVICE_ID" --hall-display-name "$HALL_DISPLAY_NAME"
   ```

   Put the same raw value in the device's own secret provisioning channel.
   It never appears in evidence or shell history — pipe it in, don't pass
   it as an argument.

5. **Install and enable.**

   ```bash
   cp deploy/campus/eduscope-quiz.service /etc/systemd/system/eduscope-quiz.service
   systemctl daemon-reload
   systemctl enable --now eduscope-quiz.service
   ln -sf /etc/nginx/sites-available/eduscope-quiz.conf /etc/nginx/sites-enabled/eduscope-quiz.conf
   systemctl reload nginx
   ss -ltnp | grep 7300   # must show 127.0.0.1:7300 only, never a public address
   ```

6. **Smoke.**

   ```bash
   printf '%s' "$DEVICE_BEARER" | \
     pnpm --filter @eduscope/quiz-service smoke:staging \
       -- --origin "$QUIZ_PUBLIC_ORIGIN" --join-code "$QUIZ_GATE_JOIN_CODE" --device-id "$QUIZ_GATE_DEVICE_ID"
   systemctl restart eduscope-quiz.service
   ```

   Reconnect both WS clients used by the smoke and confirm PostgreSQL
   state survived the restart.

7. **Backup/restore verification.**

   ```bash
   pnpm --filter @eduscope/quiz-service backup -- --output "$BACKUP_DIR/quiz-$(date +%Y%m%d%H%M%S).dump"
   sha256sum "$BACKUP_DIR"/quiz-*.dump
   # create a new, empty verification database by the DBA procedure, then:
   DATABASE_URL="$VERIFICATION_DATABASE_URL" pnpm --filter @eduscope/quiz-service restore \
     -- --input "$BACKUP_DIR/quiz-<timestamp>.dump" --confirm RESTORE-EDUSCOPE-QUIZ
   # run D's schema/count queries against the verification database, then
   # delete only that explicitly named verification database via the DBA procedure.
   ```
