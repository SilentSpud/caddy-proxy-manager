# Resolver for the test network. Answers *.cpm.test with Caddy's address and
# forwards everything else to Docker's embedded DNS so container names work.
FROM alpine:3.21

RUN apk add --no-cache dnsmasq

CMD ["dnsmasq", "--keep-in-foreground", "--log-facility=-", "--conf-file=/etc/dnsmasq.conf"]
