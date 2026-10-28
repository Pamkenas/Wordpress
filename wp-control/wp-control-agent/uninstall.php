<?php

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'wp_control_agent_secret' );
delete_option( 'wp_control_agent_key_created' );
delete_option( 'wp_control_agent_state' );
delete_option( 'wp_control_agent_nonces' );
