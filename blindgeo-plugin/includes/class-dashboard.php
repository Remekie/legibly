<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class BlindGEO_Dashboard {

    const BLINDGEO_URL = 'https://blindgeo.com';

    public static function register_widget() {
        wp_add_dashboard_widget(
            'blindgeo_dashboard_widget',
            'AI Visibility — BlindGEO',
            array( __CLASS__, 'render_widget' )
        );
    }

    public static function register_page() {
        add_options_page(
            'BlindGEO Settings',
            'BlindGEO',
            'manage_options',
            'blindgeo',
            array( __CLASS__, 'render_settings_page' )
        );
    }

    public static function enqueue_assets( $hook ) {
        if ( 'index.php' !== $hook && 'settings_page_blindgeo' !== $hook ) return;
        wp_enqueue_style( 'blindgeo', plugin_dir_url( dirname( __FILE__ ) ) . 'assets/blindgeo.css', array(), BLINDGEO_VERSION );
    }

    public static function render_widget() {
        $token    = BlindGEO_Token::get();
        $site_url = get_site_url();
        $has_schema  = ! empty( get_option( BlindGEO_Fixes::SCHEMA_KEY ) );
        $has_llmstxt = ! empty( get_option( BlindGEO_Fixes::LLMSTXT_KEY ) ) || file_exists( ABSPATH . 'llms.txt' );
        $has_robots  = ! empty( get_option( BlindGEO_Fixes::ROBOTS_KEY ) );
        ?>
        <div style="font-family:sans-serif;font-size:13px">
            <p style="margin-bottom:12px;color:#555">
                BlindGEO scans your site's AI visibility — checking if ChatGPT, Perplexity, and Claude can read and recommend it.
            </p>

            <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
                <div style="<?php echo $has_robots ? 'color:#166534;background:#dcfce7' : 'color:#991b1b;background:#fee2e2'; ?>;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600">
                    <?php echo $has_robots ? '✓ Search rules set' : '✗ Search rules missing'; ?>
                </div>
                <div style="<?php echo $has_llmstxt ? 'color:#166534;background:#dcfce7' : 'color:#991b1b;background:#fee2e2'; ?>;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600">
                    <?php echo $has_llmstxt ? '✓ AI summary in place' : '✗ AI summary missing'; ?>
                </div>
                <div style="<?php echo $has_schema ? 'color:#166534;background:#dcfce7' : 'color:#991b1b;background:#fee2e2'; ?>;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600">
                    <?php echo $has_schema ? '✓ AI knows what you sell' : '✗ AI doesn\'t know what you sell'; ?>
                </div>
            </div>

            <?php if ( ! $has_robots || ! $has_llmstxt || ! $has_schema ) : ?>
            <p style="margin-bottom:10px;color:#555">
                Some AI visibility issues need fixing.
                <a href="<?php echo esc_url( self::BLINDGEO_URL ); ?>?url=<?php echo urlencode( $site_url ); ?>" target="_blank" style="color:#0a0a0a;font-weight:600">
                    Fix in BlindGEO →
                </a>
            </p>
            <?php else : ?>
            <p style="color:#166534;margin-bottom:10px">All core AI visibility checks are passing. ✓</p>
            <?php endif; ?>

            <a href="<?php echo esc_url( self::BLINDGEO_URL ); ?>?url=<?php echo urlencode( $site_url ); ?>" target="_blank"
               style="display:inline-block;background:#0a0a0a;color:#e8ff47;padding:8px 16px;border-radius:4px;text-decoration:none;font-size:12px;font-weight:700">
                Scan your site free →
            </a>
        </div>
        <?php
    }

    public static function render_settings_page() {
        if ( isset( $_POST['blindgeo_regenerate_token'] ) && check_admin_referer( 'blindgeo_regenerate' ) ) {
            BlindGEO_Token::regenerate();
            echo '<div class="updated"><p>API token regenerated.</p></div>';
        }

        $token    = BlindGEO_Token::get();
        $site_url = get_site_url();
        ?>
        <div class="wrap" style="max-width:600px">
            <h1 style="font-family:Georgia,serif">BlindGEO — AI Visibility</h1>
            <p style="color:#555;font-size:14px;margin-bottom:24px">
                Connect this WordPress site to your BlindGEO account to apply AI visibility fixes with one click.
            </p>

            <h2 style="font-size:16px;margin-bottom:8px">1. Copy your API token</h2>
            <p style="font-size:13px;color:#555;margin-bottom:8px">This token lets BlindGEO apply fixes to your site.</p>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:20px">
                <input type="text" value="<?php echo esc_attr( $token ); ?>" readonly
                       style="flex:1;padding:8px 10px;border:1px solid #ddd;border-radius:4px;font-family:monospace;font-size:13px"
                       onclick="this.select()" />
                <button onclick="navigator.clipboard.writeText('<?php echo esc_js( $token ); ?>');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)"
                        style="padding:8px 14px;background:#0a0a0a;color:#e8ff47;border:none;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer">
                    Copy
                </button>
            </div>

            <h2 style="font-size:16px;margin-bottom:8px">2. Connect in BlindGEO</h2>
            <p style="font-size:13px;color:#555;margin-bottom:12px">
                After scanning your site on BlindGEO, go to the Deploy tab and click "Connect WordPress."
                Paste your site URL and the token above.
            </p>
            <a href="<?php echo esc_url( self::BLINDGEO_URL ); ?>?url=<?php echo urlencode( $site_url ); ?>" target="_blank"
               style="display:inline-block;background:#0a0a0a;color:#e8ff47;padding:10px 20px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:700;margin-bottom:24px">
                Scan this site on BlindGEO →
            </a>

            <h2 style="font-size:16px;margin-bottom:8px">Applied fixes</h2>
            <?php
            $has_schema  = ! empty( get_option( BlindGEO_Fixes::SCHEMA_KEY ) );
            $has_llmstxt = ! empty( get_option( BlindGEO_Fixes::LLMSTXT_KEY ) ) || file_exists( ABSPATH . 'llms.txt' );
            $has_robots  = ! empty( get_option( BlindGEO_Fixes::ROBOTS_KEY ) );
            $checks = array(
                'Search rules (robots.txt AI rules)' => $has_robots,
                'AI summary (/llms.txt)'             => $has_llmstxt,
                'Business identity (schema JSON-LD)' => $has_schema,
            );
            foreach ( $checks as $label => $done ) :
            ?>
            <div style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;display:flex;align-items:center;gap:8px">
                <span style="<?php echo $done ? 'color:#166534' : 'color:#991b1b'; ?>;font-weight:700">
                    <?php echo $done ? '✓' : '✗'; ?>
                </span>
                <?php echo esc_html( $label ); ?>
            </div>
            <?php endforeach; ?>

            <form method="post" style="margin-top:20px">
                <?php wp_nonce_field( 'blindgeo_regenerate' ); ?>
                <button type="submit" name="blindgeo_regenerate_token"
                        style="padding:6px 14px;border:1px solid #ccc;border-radius:4px;font-size:12px;cursor:pointer;background:#f5f5f5">
                    Regenerate API token
                </button>
            </form>
        </div>
        <?php
    }
}
