<?php

namespace WPControlAgent;

defined( 'ABSPATH' ) || exit;

const UPDRAFTPLUS = 'updraftplus/updraftplus.php';

const OTHER_BACKUP_PLUGINS = array(
	'backwpup/backwpup.php'                               => 'BackWPup',
	'duplicator/duplicator.php'                           => 'Duplicator',
	'wpvivid-backuprestore/wpvivid-backuprestore.php'     => 'WPvivid',
	'all-in-one-wp-migration/all-in-one-wp-migration.php' => 'All-in-One WP Migration',
	'blogvault-real-time-backup/blogvault.php'            => 'BlogVault',
);

function plain_text( $value ) {
	$text = wp_strip_all_tags( (string) $value );
	return trim( html_entity_decode( $text, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
}

function text_or( $value, $fallback ) {
	$text = plain_text( $value );
	return '' === $text ? (string) $fallback : $text;
}

function wordpress_version() {
	if ( function_exists( 'wp_get_wp_version' ) ) {
		return wp_get_wp_version();
	}
	return get_bloginfo( 'version' );
}

function load_plugin_functions() {
	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
}

function collect_snapshot() {
	load_plugin_functions();
	return array(
		'schema'        => 1,
		'agentVersion'  => VERSION,
		'generatedAt'   => time(),
		'site'          => site_info(),
		'core'          => core_info(),
		'plugins'       => plugin_list(),
		'themes'        => theme_list(),
		'pluginUpdates' => transient_info( get_site_transient( 'update_plugins' ) ),
		'themeUpdates'  => transient_info( get_site_transient( 'update_themes' ) ),
		'backup'        => backup_info(),
	);
}

function site_info() {
	return array(
		'url'          => home_url(),
		'name'         => plain_text( get_bloginfo( 'name' ) ),
		'php'          => PHP_VERSION,
		'environment'  => wp_get_environment_type(),
		'https'        => 'https' === wp_parse_url( home_url(), PHP_URL_SCHEME ),
		'debugDisplay' => WP_DEBUG && WP_DEBUG_DISPLAY,
		'fileEditing'  => ! ( defined( 'DISALLOW_FILE_EDIT' ) && DISALLOW_FILE_EDIT ),
		'multisite'    => is_multisite(),
	);
}

function newest_core_offer( $offers, $installed ) {
	$newest = null;
	foreach ( $offers as $offer ) {
		if ( ! is_object( $offer ) || ! isset( $offer->response, $offer->current ) ) {
			continue;
		}
		if ( ! in_array( $offer->response, array( 'upgrade', 'autoupdate' ), true ) ) {
			continue;
		}
		$version = (string) $offer->current;
		if ( ! version_compare( $version, $installed, '>' ) ) {
			continue;
		}
		if ( null === $newest || version_compare( $version, $newest, '>' ) ) {
			$newest = $version;
		}
	}
	return $newest;
}

function core_info() {
	$installed = wordpress_version();
	$cached    = get_site_transient( 'update_core' );

	$last_checked = null;
	if ( is_object( $cached ) && ! empty( $cached->last_checked ) ) {
		$last_checked = (int) $cached->last_checked;
	}

	$checked = null !== $last_checked
		&& isset( $cached->version_checked, $cached->updates )
		&& $cached->version_checked === $installed
		&& is_array( $cached->updates );

	$offered = null;
	if ( $checked ) {
		$offered = newest_core_offer( $cached->updates, $installed );
	}

	return array(
		'version'     => (string) $installed,
		'checked'     => $checked,
		'offered'     => $offered,
		'lastChecked' => $last_checked,
	);
}

function plugin_list() {
	$auto_updates = (array) get_site_option( 'auto_update_plugins', array() );
	$list         = array();

	foreach ( get_plugins() as $file => $data ) {
		$list[] = array(
			'file'       => (string) $file,
			'name'       => text_or( $data['Name'], $file ),
			'version'    => plain_text( $data['Version'] ),
			'kind'       => 'plugin',
			'active'     => is_plugin_active( $file ),
			'autoUpdate' => in_array( $file, $auto_updates, true ),
		);
	}
	foreach ( get_mu_plugins() as $file => $data ) {
		$list[] = array(
			'file'       => (string) $file,
			'name'       => text_or( $data['Name'], $file ),
			'version'    => plain_text( $data['Version'] ),
			'kind'       => 'must-use',
			'active'     => true,
			'autoUpdate' => false,
		);
	}
	foreach ( get_dropins() as $file => $data ) {
		$list[] = array(
			'file'       => (string) $file,
			'name'       => text_or( $data['Name'], $file ),
			'version'    => plain_text( $data['Version'] ),
			'kind'       => 'drop-in',
			'active'     => true,
			'autoUpdate' => false,
		);
	}
	return $list;
}

function theme_list() {
	$auto_updates = (array) get_site_option( 'auto_update_themes', array() );
	$stylesheet   = get_stylesheet();
	$template     = get_template();
	$list         = array();

	foreach ( wp_get_themes() as $slug => $theme ) {
		$slug   = (string) $slug;
		$list[] = array(
			'slug'       => $slug,
			'name'       => text_or( $theme->get( 'Name' ), $slug ),
			'version'    => plain_text( $theme->get( 'Version' ) ),
			'active'     => $slug === $stylesheet,
			'parent'     => $slug === $template && $template !== $stylesheet,
			'autoUpdate' => in_array( $slug, $auto_updates, true ),
		);
	}
	return $list;
}

function offered_version( $item ) {
	$item = (array) $item;
	if ( isset( $item['new_version'] ) && is_scalar( $item['new_version'] ) ) {
		return (string) $item['new_version'];
	}
	return null;
}

function transient_info( $cached ) {
	if ( ! is_object( $cached ) || empty( $cached->last_checked ) ) {
		return array(
			'checked'         => false,
			'lastChecked'     => null,
			'updates'         => new \stdClass(),
			'noUpdate'        => array(),
			'checkedVersions' => new \stdClass(),
		);
	}

	$updates = array();
	foreach ( (array) ( $cached->response ?? array() ) as $id => $item ) {
		$updates[ (string) $id ] = offered_version( $item );
	}

	$checked_versions = array();
	foreach ( (array) ( $cached->checked ?? array() ) as $id => $version ) {
		if ( is_scalar( $version ) ) {
			$checked_versions[ (string) $id ] = (string) $version;
		}
	}

	$no_update = array();
	foreach ( array_keys( (array) ( $cached->no_update ?? array() ) ) as $id ) {
		$no_update[] = (string) $id;
	}

	return array(
		'checked'         => true,
		'lastChecked'     => (int) $cached->last_checked,
		'updates'         => (object) $updates,
		'noUpdate'        => $no_update,
		'checkedVersions' => (object) $checked_versions,
	);
}

function backup_size( $entry ) {
	$size = 0;
	foreach ( $entry as $key => $value ) {
		if ( '-size' === substr( (string) $key, -5 ) && is_numeric( $value ) ) {
			$size += (int) $value;
		}
	}
	return $size > 0 ? $size : null;
}

function backup_storage( $entry ) {
	if ( empty( $entry['service'] ) ) {
		return '';
	}
	$services = array_filter( (array) $entry['service'], 'is_string' );
	$services = array_diff( $services, array( 'none', '' ) );
	return empty( $services ) ? 'local' : implode( ', ', $services );
}

function updraftplus_history() {
	$history = get_option( 'updraft_backup_history' );
	if ( ! is_array( $history ) ) {
		return array();
	}
	krsort( $history );

	$list = array();
	foreach ( array_slice( $history, 0, 10, true ) as $time => $entry ) {
		if ( ! is_numeric( $time ) || ! is_array( $entry ) ) {
			continue;
		}
		$list[] = array(
			'time'    => (int) $time,
			'size'    => backup_size( $entry ),
			'storage' => backup_storage( $entry ),
		);
	}
	return $list;
}

function backup_info() {
	if ( is_plugin_active( UPDRAFTPLUS ) ) {
		$last = get_option( 'updraft_last_backup' );
		if ( ! is_array( $last ) || empty( $last['backup_time'] ) ) {
			return array(
				'source'  => 'UpdraftPlus',
				'lastAt'  => null,
				'success' => null,
				'history' => array(),
			);
		}
		return array(
			'source'  => 'UpdraftPlus',
			'lastAt'  => (int) $last['backup_time'],
			'success' => ! empty( $last['success'] ),
			'history' => updraftplus_history(),
		);
	}

	foreach ( OTHER_BACKUP_PLUGINS as $file => $name ) {
		if ( is_plugin_active( $file ) ) {
			return array(
				'source'  => $name,
				'lastAt'  => null,
				'success' => null,
				'history' => array(),
			);
		}
	}

	return array(
		'source'  => null,
		'lastAt'  => null,
		'success' => null,
		'history' => array(),
	);
}
