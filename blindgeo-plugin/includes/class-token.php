<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class BlindGEO_Token {

    const OPTION_KEY = 'blindgeo_api_token';

    public static function generate_on_activate() {
        if ( ! get_option( self::OPTION_KEY ) ) {
            self::regenerate();
        }
    }

    public static function get() {
        return get_option( self::OPTION_KEY, '' );
    }

    public static function regenerate() {
        $token = wp_generate_password( 48, false );
        update_option( self::OPTION_KEY, $token, false );
        return $token;
    }

    public static function verify( $request ) {
        $token  = self::get();
        $header = $request->get_header( 'X-BlindGEO-Token' );
        if ( empty( $token ) || empty( $header ) ) return false;
        return hash_equals( $token, $header );
    }
}
