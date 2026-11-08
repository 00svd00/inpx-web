# syntax=docker/dockerfile:1

FROM alpine:3.24
WORKDIR /opt/inpx-web
COPY --from=docker-context / /opt/inpx-web/
EXPOSE 12380
ENTRYPOINT ["/opt/inpx-web/inpx-web", "--data-dir=/data"]