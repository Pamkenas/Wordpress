<?php

namespace WPControlManager;

defined( 'ABSPATH' ) || exit;

const SEVERITY_ORDER = array(
	'critical' => 0,
	'moderate' => 1,
	'low'      => 2,
	'ok'       => 3,
);

function check( $key, $severity, $title, $detail ) {
	return array(
		'key'      => $key,
		'severity' => $severity,
		'title'    => $title,
		'detail'   => $detail,
	);
}

function count_items( $components, $field, $value ) {
	$count = 0;
	foreach ( $components as $item ) {
		if ( 'core' !== $item['type'] && $value === $item[ $field ] ) {
			++$count;
		}
	}
	return $count;
}

function core_check( $core ) {
	if ( 'yes' === $core['update_state'] ) {
		return check( 'core', 'moderate', 'WordPress update available', 'WordPress ' . $core['update_version'] . ' is available. Installed: ' . $core['version'] . '.' );
	}
	if ( 'unknown' === $core['update_state'] ) {
		return check( 'core', 'low', 'WordPress update state unknown', $core['update_note'] );
	}
	return check( 'core', 'ok', 'WordPress is up to date', 'Version ' . $core['version'] . '.' );
}

function php_check( $php, $minimum ) {
	if ( version_compare( $php, $minimum, '<' ) ) {
		return check( 'php', 'moderate', 'Old PHP version', 'PHP ' . $php . ' no longer gets security fixes. Use PHP ' . $minimum . ' or newer.' );
	}
	return check( 'php', 'ok', 'PHP version is supported', 'PHP ' . $php . '.' );
}

function https_check( $site ) {
	if ( ! empty( $site['https'] ) ) {
		return check( 'https', 'ok', 'The site uses HTTPS', 'Visitors connect securely.' );
	}
	if ( 'local' === ( $site['environment'] ?? '' ) ) {
		return check( 'https', 'low', 'No HTTPS (local test site)', 'Fine for a test site on this computer. A real site must use HTTPS.' );
	}
	return check( 'https', 'critical', 'The site does not use HTTPS', 'Passwords and forms are sent unencrypted. Install a certificate and switch the site address to https://.' );
}

function backup_check( $backup, $settings ) {
	$source = isset( $backup['source'] ) && is_string( $backup['source'] ) ? $backup['source'] : '';
	if ( '' === $source ) {
		return check( 'backup', 'moderate', 'No backup information', 'No supported backup plugin was found. UpdraftPlus is supported.' );
	}
	if ( empty( $backup['lastAt'] ) ) {
		return check( 'backup', 'moderate', 'Backup time unknown', $source . ' is active, but WP Control can\'t read its backups yet.' );
	}

	$days = ( time() - (int) $backup['lastAt'] ) / DAY_IN_SECONDS;
	if ( false === ( $backup['success'] ?? null ) ) {
		return check( 'backup', 'critical', 'The last backup failed', 'Check ' . $source . ' on the site.' );
	}
	if ( $days > (int) $settings['backup_critical_days'] ) {
		return check( 'backup', 'critical', 'The last backup is old', 'The last backup is ' . plural( floor( $days ), 'day', 'days' ) . ' old.' );
	}
	if ( $days > (int) $settings['backup_warning_days'] ) {
		return check( 'backup', 'moderate', 'The last backup is getting old', 'The last backup is ' . plural( floor( $days ), 'day', 'days' ) . ' old.' );
	}
	return check( 'backup', 'ok', 'Recent backup', 'Made with ' . $source . '.' );
}

function compute_checks( $snapshot, $components, $settings ) {
	$site   = $snapshot['site'];
	$checks = array( core_check( $components['core|wordpress'] ) );

	$pending = count_items( $components, 'update_state', 'yes' );
	if ( $pending > 0 ) {
		$checks[] = check( 'updates', 'moderate', 'Plugin and theme updates', plural( $pending, 'update is', 'updates are' ) . ' waiting.' );
	} else {
		$checks[] = check( 'updates', 'ok', 'Plugins and themes', 'No known updates are waiting.' );
	}

	$unknown = count_items( $components, 'update_state', 'unknown' );
	if ( $unknown > 0 ) {
		$checks[] = check( 'unknown', 'low', 'Some updates need a manual check', plural( $unknown, 'plugin or theme', 'plugins or themes' ) . ' (for example premium ones) can\'t be checked automatically.' );
	}

	$checks[] = php_check( (string) $site['php'], (string) $settings['min_php'] );
	$checks[] = https_check( $site );

	if ( ! empty( $site['debugDisplay'] ) ) {
		$checks[] = check( 'debug', 'moderate', 'Errors are shown to visitors', 'WP_DEBUG_DISPLAY is on. Turn it off in wp-config.php.' );
	}
	if ( ! empty( $site['fileEditing'] ) ) {
		$checks[] = check( 'file_editing', 'low', 'The file editor is on', 'Admins can edit PHP files in wp-admin. Add define( \'DISALLOW_FILE_EDIT\', true ); to wp-config.php.' );
	}

	$inactive = 0;
	foreach ( $components as $item ) {
		if ( 'plugin' === $item['type'] && 'inactive' === $item['status'] ) {
			++$inactive;
		}
	}
	if ( $inactive > 0 ) {
		$checks[] = check( 'inactive_plugins', 'low', 'Inactive plugins', plural( $inactive, 'plugin is', 'plugins are' ) . ' inactive. Remove the ones that aren\'t needed.' );
	}

	$checks[] = backup_check( $snapshot['backup'], $settings );

	$agent_version = (string) ( $snapshot['agentVersion'] ?? '' );
	if ( version_compare( $agent_version, LATEST_AGENT_VERSION, '<' ) ) {
		$checks[] = check( 'agent', 'low', 'WP Control Agent is outdated', 'The site runs agent ' . $agent_version . '. The newest is ' . LATEST_AGENT_VERSION . '.' );
	}

	usort(
		$checks,
		function ( $a, $b ) {
			return SEVERITY_ORDER[ $a['severity'] ] - SEVERITY_ORDER[ $b['severity'] ];
		}
	);
	return $checks;
}
