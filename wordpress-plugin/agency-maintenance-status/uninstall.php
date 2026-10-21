<?php

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

remove_role( 'agency_maintenance_auditor' );

foreach ( wp_roles()->role_objects as $agency_maintenance_role ) {
	$agency_maintenance_role->remove_cap( 'view_agency_maintenance_status' );
}
