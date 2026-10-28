<?php

namespace WPControlManager;

use WP_Error;

defined( 'ABSPATH' ) || exit;

const NOTES = array(
	'never_checked' => 'WordPress has not checked for updates yet.',
	'not_in_check'  => 'Not included in the last WordPress update check.',
	'stale'         => 'The installed version changed since the last update check.',
	'untracked'     => 'No update information (premium or custom?). Check it manually.',
	'must_use'      => 'WordPress does not check must-use plugins for updates.',
	'drop_in'       => 'WordPress does not check drop-ins for updates.',
	'core_unknown'  => 'WordPress has not checked for core updates for this version yet.',
);

function update_state( $id, $version, $transient ) {
	if ( empty( $transient['checked'] ) ) {
		return array( 'unknown', '', NOTES['never_checked'] );
	}
	if ( ! array_key_exists( $id, $transient['checkedVersions'] ) ) {
		return array( 'unknown', '', NOTES['not_in_check'] );
	}
	if ( (string) $transient['checkedVersions'][ $id ] !== $version ) {
		return array( 'unknown', '', NOTES['stale'] );
	}
	if ( array_key_exists( $id, $transient['updates'] ) ) {
		return array( 'yes', (string) $transient['updates'][ $id ], '' );
	}
	if ( in_array( $id, $transient['noUpdate'], true ) ) {
		return array( 'no', '', '' );
	}
	return array( 'unknown', '', NOTES['untracked'] );
}

function agent_update_state( $version ) {
	if ( version_compare( $version, LATEST_AGENT_VERSION, '<' ) ) {
		return array( 'yes', LATEST_AGENT_VERSION, '' );
	}
	return array( 'no', '', '' );
}

function core_update_state( $core ) {
	if ( empty( $core['checked'] ) ) {
		return array( 'unknown', '', NOTES['core_unknown'] );
	}
	if ( empty( $core['offered'] ) || ! is_string( $core['offered'] ) ) {
		return array( 'no', '', '' );
	}
	return array( 'yes', $core['offered'], '' );
}

function component( $type, $slug, $name, $version, $status, $auto_update, $state ) {
	return array(
		'type'           => $type,
		'slug'           => clean_text( $slug, 190 ),
		'name'           => clean_text( $name, 255 ),
		'version'        => clean_text( $version, 60 ),
		'status'         => $status,
		'auto_update'    => $auto_update ? 1 : 0,
		'update_state'   => $state[0],
		'update_version' => clean_text( $state[1], 60 ),
		'update_note'    => clean_text( $state[2], 255 ),
	);
}

function plugin_state( $plugin, $version, $updates ) {
	if ( 'must-use' === $plugin['kind'] ) {
		return array( 'unknown', '', NOTES['must_use'] );
	}
	if ( 'drop-in' === $plugin['kind'] ) {
		return array( 'unknown', '', NOTES['drop_in'] );
	}
	if ( AGENT_PLUGIN === $plugin['file'] ) {
		return agent_update_state( $version );
	}
	return update_state( $plugin['file'], $version, $updates );
}

function components_from_snapshot( $snapshot ) {
	$list = array();

	$core                   = $snapshot['core'];
	$list['core|wordpress'] = component( 'core', 'wordpress', 'WordPress', $core['version'], 'active', false, core_update_state( $core ) );

	foreach ( $snapshot['plugins'] as $plugin ) {
		if ( ! in_array( $plugin['kind'], array( 'plugin', 'must-use', 'drop-in' ), true ) ) {
			continue;
		}
		$version = clean_text( $plugin['version'], 60 );
		$status  = 'active';
		if ( 'plugin' === $plugin['kind'] && empty( $plugin['active'] ) ) {
			$status = 'inactive';
		}
		$state = plugin_state( $plugin, $version, $snapshot['pluginUpdates'] );
		$item  = component( $plugin['kind'], $plugin['file'], $plugin['name'], $version, $status, ! empty( $plugin['autoUpdate'] ), $state );

		$list[ $item['type'] . '|' . $item['slug'] ] = $item;
	}

	foreach ( $snapshot['themes'] as $theme ) {
		$version = clean_text( $theme['version'], 60 );
		$status  = 'inactive';
		if ( ! empty( $theme['active'] ) ) {
			$status = 'active';
		} elseif ( ! empty( $theme['parent'] ) ) {
			$status = 'parent';
		}
		$state = update_state( $theme['slug'], $version, $snapshot['themeUpdates'] );
		$item  = component( 'theme', $theme['slug'], $theme['name'], $version, $status, ! empty( $theme['autoUpdate'] ), $state );

		$list[ $item['type'] . '|' . $item['slug'] ] = $item;
	}
	return $list;
}

function version_event( $old, $new ) {
	if ( $old === $new || '' === $old || '' === $new ) {
		return '';
	}
	return version_compare( $old, $new, '<' ) ? 'updated' : 'downgraded';
}

function status_event( $old, $new ) {
	if ( $old === $new ) {
		return '';
	}
	if ( 'active' === $new ) {
		return 'activated';
	}
	if ( 'active' === $old ) {
		return 'deactivated';
	}
	return '';
}

function stored_components( $site_id ) {
	global $wpdb;
	$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . table( 'components' ) . ' WHERE site_id = %d', $site_id ) );

	$list = array();
	foreach ( $rows as $row ) {
		$list[ $row->type . '|' . $row->slug ] = $row;
	}
	return $list;
}

function component_fields( $item, $now ) {
	return array(
		'name'           => $item['name'],
		'version'        => $item['version'],
		'status'         => $item['status'],
		'auto_update'    => $item['auto_update'],
		'update_state'   => $item['update_state'],
		'update_version' => $item['update_version'],
		'update_note'    => $item['update_note'],
		'last_seen_at'   => $now,
		'removed_at'     => null,
	);
}

function insert_component( $site_id, $item, $now ) {
	global $wpdb;
	$fields = array_merge(
		array(
			'site_id'       => $site_id,
			'type'          => $item['type'],
			'slug'          => $item['slug'],
			'first_seen_at' => $now,
		),
		component_fields( $item, $now )
	);
	$wpdb->insert( table( 'components' ), $fields );
	return (int) $wpdb->insert_id;
}

function add_event( $site_id, $component_id, $run_id, $item, $event, $old_value, $new_value, $now ) {
	global $wpdb;
	$wpdb->insert(
		table( 'component_events' ),
		array(
			'site_id'      => $site_id,
			'component_id' => $component_id,
			'sync_run_id'  => $run_id,
			'type'         => $item['type'],
			'slug'         => $item['slug'],
			'name'         => $item['name'],
			'event'        => $event,
			'old_value'    => clean_text( $old_value, 60 ),
			'new_value'    => clean_text( $new_value, 60 ),
			'auto_update'  => (int) $item['auto_update'],
			'detected_at'  => $now,
		)
	);
}

function resolve_offers( $component_id, $now ) {
	global $wpdb;
	$wpdb->query( $wpdb->prepare( 'UPDATE ' . table( 'update_offers' ) . ' SET resolved_at = %s WHERE component_id = %d AND resolved_at IS NULL', $now, $component_id ) );
}

function sync_offer( $site_id, $component_id, $item, $now ) {
	global $wpdb;
	$open = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . table( 'update_offers' ) . ' WHERE component_id = %d AND resolved_at IS NULL ORDER BY id DESC LIMIT 1', $component_id ) );

	if ( 'yes' !== $item['update_state'] ) {
		if ( $open ) {
			resolve_offers( $component_id, $now );
		}
		return;
	}
	if ( $open && $open->new_version === $item['update_version'] && $open->current_version === $item['version'] ) {
		$wpdb->update( table( 'update_offers' ), array( 'last_seen_at' => $now ), array( 'id' => $open->id ) );
		return;
	}
	if ( $open ) {
		resolve_offers( $component_id, $now );
	}
	$wpdb->insert(
		table( 'update_offers' ),
		array(
			'site_id'         => $site_id,
			'component_id'    => $component_id,
			'current_version' => $item['version'],
			'new_version'     => $item['update_version'],
			'first_seen_at'   => $now,
			'last_seen_at'    => $now,
		)
	);
}

function save_checks( $site_id, $checks, $now ) {
	global $wpdb;
	$wpdb->delete( table( 'site_checks' ), array( 'site_id' => $site_id ) );
	foreach ( $checks as $item ) {
		$wpdb->insert(
			table( 'site_checks' ),
			array(
				'site_id'    => $site_id,
				'check_key'  => $item['key'],
				'severity'   => $item['severity'],
				'title'      => clean_text( $item['title'], 190 ),
				'detail'     => clean_text( $item['detail'], 255 ),
				'checked_at' => $now,
			)
		);
	}
}

function save_backups( $site_id, $backup, $now ) {
	global $wpdb;
	$source = isset( $backup['source'] ) && is_string( $backup['source'] ) ? clean_text( $backup['source'], 60 ) : '';
	if ( '' === $source || empty( $backup['lastAt'] ) || ! is_numeric( $backup['lastAt'] ) ) {
		return null;
	}

	$newest_success = null;
	$history        = isset( $backup['history'] ) && is_array( $backup['history'] ) ? $backup['history'] : array();
	foreach ( $history as $item ) {
		if ( ! is_array( $item ) || empty( $item['time'] ) || ! is_numeric( $item['time'] ) ) {
			continue;
		}
		$newest_success = max( (int) $newest_success, (int) $item['time'] );
		$size    = isset( $item['size'] ) && is_numeric( $item['size'] ) ? (int) $item['size'] : 0;
		$storage = isset( $item['storage'] ) && is_string( $item['storage'] ) ? clean_text( $item['storage'], 100 ) : '';
		$wpdb->query(
			$wpdb->prepare(
				'INSERT IGNORE INTO ' . table( 'backups' ) . ' (site_id, source, backup_at, status, size_bytes, storage, recorded_at) VALUES (%d, %s, %s, %s, NULLIF(%d, 0), %s, %s)',
				$site_id,
				$source,
				gmt_from_timestamp( $item['time'] ),
				'success',
				$size,
				$storage,
				$now
			)
		);
	}

	$status = false === ( $backup['success'] ?? null ) ? 'failed' : 'success';
	if ( 'success' === $status ) {
		$newest_success = max( (int) $newest_success, (int) $backup['lastAt'] );
	}
	$wpdb->query(
		$wpdb->prepare(
			'INSERT INTO ' . table( 'backups' ) . ' (site_id, source, backup_at, status, size_bytes, storage, recorded_at) VALUES (%d, %s, %s, %s, NULL, %s, %s) ON DUPLICATE KEY UPDATE status = VALUES(status)',
			$site_id,
			$source,
			gmt_from_timestamp( $backup['lastAt'] ),
			$status,
			'',
			$now
		)
	);
	return $newest_success ? gmt_from_timestamp( $newest_success ) : null;
}

function count_state( $components, $state ) {
	$count = 0;
	foreach ( $components as $item ) {
		if ( $state === $item['update_state'] ) {
			++$count;
		}
	}
	return $count;
}

function active_theme_name( $components ) {
	foreach ( $components as $item ) {
		if ( 'theme' === $item['type'] && 'active' === $item['status'] ) {
			return trim( $item['name'] . ' ' . $item['version'] );
		}
	}
	return '';
}

function ingest( $site, $snapshot, $run_id ) {
	global $wpdb;
	$now      = now();
	$found    = components_from_snapshot( $snapshot );
	$stored   = stored_components( $site->id );
	$baseline = empty( $stored );
	$changes  = 0;

	$wpdb->query( 'START TRANSACTION' );

	foreach ( $found as $key => $item ) {
		$row = $stored[ $key ] ?? null;
		if ( null === $row ) {
			$component_id = insert_component( $site->id, $item, $now );
			if ( ! $baseline ) {
				add_event( $site->id, $component_id, $run_id, $item, 'installed', '', $item['version'], $now );
				++$changes;
			}
		} else {
			$component_id = (int) $row->id;
			if ( null !== $row->removed_at ) {
				add_event( $site->id, $component_id, $run_id, $item, 'installed', '', $item['version'], $now );
				++$changes;
			} else {
				$event = version_event( $row->version, $item['version'] );
				if ( '' !== $event ) {
					add_event( $site->id, $component_id, $run_id, $item, $event, $row->version, $item['version'], $now );
					++$changes;
				}
				$event = status_event( $row->status, $item['status'] );
				if ( '' !== $event ) {
					add_event( $site->id, $component_id, $run_id, $item, $event, $row->status, $item['status'], $now );
					++$changes;
				}
			}
			$wpdb->update( table( 'components' ), component_fields( $item, $now ), array( 'id' => $component_id ) );
		}
		sync_offer( $site->id, $component_id, $item, $now );
	}

	foreach ( $stored as $key => $row ) {
		if ( isset( $found[ $key ] ) || null !== $row->removed_at ) {
			continue;
		}
		$wpdb->update( table( 'components' ), array( 'removed_at' => $now ), array( 'id' => $row->id ) );
		resolve_offers( (int) $row->id, $now );
		$item = array(
			'type'        => $row->type,
			'slug'        => $row->slug,
			'name'        => $row->name,
			'auto_update' => (int) $row->auto_update,
		);
		add_event( $site->id, (int) $row->id, $run_id, $item, 'removed', $row->version, '', $now );
		++$changes;
	}

	$checks = compute_checks( $snapshot, $found, settings() );
	save_checks( $site->id, $checks, $now );
	$last_backup = save_backups( $site->id, $snapshot['backup'], $now );

	$critical = 0;
	foreach ( $checks as $item ) {
		if ( 'critical' === $item['severity'] ) {
			++$critical;
		}
	}

	$wpdb->update(
		table( 'sites' ),
		array(
			'status'          => 'online',
			'wp_version'      => clean_text( $found['core|wordpress']['version'], 40 ),
			'php_version'     => clean_text( $snapshot['site']['php'], 40 ),
			'active_theme'    => clean_text( active_theme_name( $found ), 190 ),
			'pending_updates' => count_state( $found, 'yes' ),
			'unknown_updates' => count_state( $found, 'unknown' ),
			'critical_issues' => $critical,
			'last_backup_at'  => $last_backup,
			'last_sync_at'    => $now,
			'last_attempt_at' => $now,
			'last_error'      => '',
		),
		array( 'id' => $site->id )
	);
	$wpdb->update(
		table( 'agents' ),
		array(
			'agent_version' => clean_text( $snapshot['agentVersion'] ?? '', 20 ),
			'last_seen_at'  => $now,
		),
		array( 'site_id' => $site->id )
	);

	$wpdb->query( 'COMMIT' );
	return $changes;
}

function start_run( $site_id, $trigger ) {
	global $wpdb;
	$wpdb->insert(
		table( 'sync_runs' ),
		array(
			'site_id'      => $site_id,
			'trigger_type' => $trigger,
			'status'       => 'running',
			'message'      => '',
			'changes'      => 0,
			'started_at'   => now(),
		)
	);
	return (int) $wpdb->insert_id;
}

function finish_run( $run_id, $status, $message, $changes ) {
	global $wpdb;
	$wpdb->update(
		table( 'sync_runs' ),
		array(
			'status'      => $status,
			'message'     => $message,
			'changes'     => $changes,
			'finished_at' => now(),
		),
		array( 'id' => $run_id )
	);
}

function sync_site( $site_id, $trigger ) {
	global $wpdb;
	$site = get_site_row( $site_id );
	if ( ! $site ) {
		return new WP_Error( 'wpc_missing', 'The website was not found.' );
	}

	$agent  = get_agent_row( $site->id );
	$secret = $agent ? decrypt_secret( $agent->secret ) : '';
	$run_id = start_run( $site->id, $trigger );

	if ( '' === $secret ) {
		$result = sync_error( 'error', 'The saved connection key can\'t be read. Enter the key again under Edit website.' );
	} else {
		$result = fetch_snapshot( $site->url, $secret );
	}

	if ( is_wp_error( $result ) ) {
		$data    = $result->get_error_data();
		$status  = is_array( $data ) && isset( $data['site_status'] ) ? $data['site_status'] : 'error';
		$message = $result->get_error_message();
		finish_run( $run_id, 'failed', $message, 0 );
		$wpdb->update(
			table( 'sites' ),
			array(
				'status'          => $status,
				'last_error'      => $message,
				'last_attempt_at' => now(),
			),
			array( 'id' => $site->id )
		);
		return $result;
	}

	$changes = ingest( $site, $result, $run_id );
	finish_run( $run_id, 'success', $changes > 0 ? plural( $changes, 'change', 'changes' ) . ' detected' : 'No changes', $changes );
	return $changes;
}

function run_scheduled_sync( $trigger = 'schedule', $ids = array() ) {
	global $wpdb;
	$trigger = 'manual' === $trigger ? 'manual' : 'schedule';
	if ( get_transient( 'wpc_sync_lock' ) ) {
		if ( 'manual' === $trigger ) {
			wp_schedule_single_event( time() + MINUTE_IN_SECONDS, SYNC_NOW_HOOK, array( 'manual', $ids ) );
		}
		return;
	}
	set_transient( 'wpc_sync_lock', time(), 10 * MINUTE_IN_SECONDS );
	if ( function_exists( 'set_time_limit' ) ) {
		set_time_limit( 300 );
	}

	if ( empty( $ids ) ) {
		$ids = $wpdb->get_col( 'SELECT id FROM ' . table( 'sites' ) . ' ORDER BY last_attempt_at IS NULL DESC, last_attempt_at ASC' );
	}
	$started = time();
	foreach ( $ids as $id ) {
		if ( time() - $started > 240 ) {
			break;
		}
		sync_site( (int) $id, $trigger );
	}
	delete_transient( 'wpc_sync_lock' );
}
add_action( SYNC_HOOK, __NAMESPACE__ . '\run_scheduled_sync', 10, 2 );
add_action( SYNC_NOW_HOOK, __NAMESPACE__ . '\run_scheduled_sync', 10, 2 );
