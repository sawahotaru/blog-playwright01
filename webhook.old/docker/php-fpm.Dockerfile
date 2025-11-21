FROM php:8.2-fpm-alpine

RUN set -eux; \
  apk add --no-cache --virtual .build-deps $PHPIZE_DEPS \
  && pecl install apcu \
  && docker-php-ext-enable apcu \
  && pecl clear-cache \
  && apk del .build-deps
