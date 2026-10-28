<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

function encryption_key() {
	return hash( 'sha256', 'wp-control|' . wp_salt( 'secure_auth' ), true );
}

function encrypt_secret( $secret ) {
	$nonce = random_bytes( SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
	$box   = sodium_crypto_secretbox( $secret, $nonce, encryption_key() );
	return 'v1:' . base64_encode( $nonce . $box );
}

function decrypt_secret( $stored ) {
	if ( 0 !== strpos( (string) $stored, 'v1:' ) ) {
		return '';
	}
	$raw = base64_decode( substr( $stored, 3 ), true );
	if ( false === $raw || strlen( $raw ) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ) {
		return '';
	}
	$nonce  = substr( $raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES );
	$secret = sodium_crypto_secretbox_open( substr( $raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES ), $nonce, encryption_key() );
	return false === $secret ? '' : $secret;
}
