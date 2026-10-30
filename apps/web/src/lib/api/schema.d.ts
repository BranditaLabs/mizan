/* Generated from apps/api/openapi.json by `npm run gen:api -w @mizan/web`. Do not edit. */

export interface paths {
    "/v1/orders/{id}/payments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PaymentsController_get"];
        put?: never;
        post: operations["PaymentsController_record"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/payments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PaymentsListController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/payments/mix": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PaymentsListController_mix"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/refunds/options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrderRefundsController_options"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/refunds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OrderRefundsController_request"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/refunds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RefundsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/refunds/{refundId}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["RefundsController_approve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/refunds/{refundId}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["RefundsController_reject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/refunds/{refundId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["RefundsController_complete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/refunds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["RefundSettingsController_get"];
        put: operations["RefundSettingsController_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrdersController_list"];
        put?: never;
        post: operations["OrdersController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OrdersController_bulkRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/bulk/{bulkId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrdersController_bulkProgress"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrdersController_products"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrdersController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/reveal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OrdersController_reveal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OrdersController_resolveDuplicate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrderSettingsController_get"];
        put: operations["OrderSettingsController_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/onboarding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OnboardingController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["OnboardingController_update"];
        trace?: never;
    };
    "/v1/products/variants/costs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CatalogController_list"];
        put: operations["CatalogController_set"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProductsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/products/variants/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["ProductsController_update"];
        trace?: never;
    };
    "/v1/products/costs/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProductsController_import"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/stock": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StockController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/stock/movements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StockController_record"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/stock/{variantId}/movements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StockController_history"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/stock/{variantId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["StockController_threshold"];
        trace?: never;
    };
    "/v1/settings/inventory": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["InventorySettingsController_get"];
        put: operations["InventorySettingsController_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tickets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TicketsController_list"];
        put?: never;
        post: operations["TicketsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tickets/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TicketsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["TicketsController_update"];
        trace?: never;
    };
    "/v1/orders/{id}/returns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ReturnsController_state"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/returns/inspect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ReturnsController_inspect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/exchanges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ExchangesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/exchanges": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ExchangesController_forOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/partial-delivery": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DoorController_partial"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/refusal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DoorController_refusal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/ship": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShippingController_ship"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/ship/manual": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShippingController_manual"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shipments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TrackingController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shipments/statuses/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TrackingController_importStatuses"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shipments/{id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TrackingController_history"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shipments/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TrackingController_setStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/couriers/scorecard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ScorecardController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StaffController_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/staff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StaffController_list"];
        put?: never;
        post: operations["StaffController_add"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/staff/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["StaffController_update"];
        trace?: never;
    };
    "/v1/platform/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StaffController_trail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/stores": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StoresController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/stores/{storeId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StoresController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/stores/{storeId}/suspend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StoresController_suspend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/stores/{storeId}/reactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StoresController_reactivate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/stores/{storeId}/plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["StoresController_changePlan"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/stores/{storeId}/notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StoresController_addNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/stores/{storeId}/access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffSupportAccessController_open"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/stores/{storeId}/access/end": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StaffSupportAccessController_end"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StaffSupportAccessController_mine"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/support-access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StoreSupportAccessController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/support-access/{id}/end": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StoreSupportAccessController_end"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_overview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/health/dead-letters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_deadLetters"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/health/dead-letters/{id}/replay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["HealthController_replay"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["UsersController_search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["UsersController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/users/{id}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["UsersController_disable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/users/{id}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["UsersController_enable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/flags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlatformFlagsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/flags/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["PlatformFlagsController_put"];
        post?: never;
        delete: operations["PlatformFlagsController_remove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/flags/{key}/stores/{storeId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["PlatformFlagsController_putStore"];
        post?: never;
        delete: operations["PlatformFlagsController_clearStore"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/announcements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PlatformFlagsController_announcements"];
        put?: never;
        post: operations["PlatformFlagsController_announce"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/announcements/{id}/end": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PlatformFlagsController_end"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/flags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StoreFlagsController_storeFlags"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/announcements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StoreFlagsController_storeAnnouncements"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/usage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["BillingController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/usage/upgrade": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["BillingController_upgrade"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/metrics/catalogue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ReportsController_catalogue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/metrics/values": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ReportsController_values"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/dashboards": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DashboardsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/dashboards/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DashboardsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/dashboards/{id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DashboardsController_export"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/ops/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OpsController_sync"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/automations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AutomationsController_list"];
        put?: never;
        post: operations["AutomationsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/automations/recipes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AutomationsController_recipes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/automations/recipes/{key}/install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AutomationsController_install"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/automations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AutomationsController_get"];
        put: operations["AutomationsController_update"];
        post?: never;
        delete: operations["AutomationsController_remove"];
        options?: never;
        head?: never;
        patch: operations["AutomationsController_patch"];
        trace?: never;
    };
    "/v1/automations/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AutomationsController_test"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CatalogController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NotificationsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notifications/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NotificationsController_markRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/profit/home": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProfitController_home"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/profit/breakdown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProfitController_breakdown"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/ad-spend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProfitController_adSpend"];
        put: operations["ProfitController_setAdSpend"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/ad-spend/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProfitController_importAdSpend"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/ad-spend/{day}/{platform}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["ProfitController_removeAdSpend"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/pnl": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProfitController_orderPnl"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/profit/recalculate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ProfitController_recalculate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/cost-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProfitController_list"];
        put?: never;
        post: operations["ProfitController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/cost-rules/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["ProfitController_end"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/fx-rates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ProfitController_rates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/fx-rates/{day}/{quote}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["ProfitController_setRate"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/confirmation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ConfirmationController_summary"];
        put?: never;
        post: operations["ConfirmationController_answer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/confirmation/link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConfirmationController_link"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/confirmation/no-answer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConfirmationController_noAnswer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/whatsapp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConfirmationController_connectWhatsApp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/whatsapp/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConfirmationController_checkWhatsApp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/confirmation/queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ConfirmationController_queueSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/confirmation/queue/next": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConfirmationController_queueNext"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/confirmation/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ConfirmationController_results"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/confirmation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ConfirmationController_settings"];
        put: operations["ConfirmationController_saveSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/confirmation/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConfirmationController_preview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/public/confirm/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PublicConfirmationController_view"];
        put?: never;
        post: operations["PublicConfirmationController_answer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/offers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OffersController_settings"];
        put: operations["OffersController_saveSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/offer-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OffersController_rules"];
        put?: never;
        post: operations["OffersController_addRule"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/offer-rules/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["OffersController_setRule"];
        trace?: never;
    };
    "/v1/offer-products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OffersController_products"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/offers/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OffersController_summary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/orders/{id}/offer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["OffersController_decide"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_live"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_ready"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["MeController_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tenants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TenantsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tenant": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TenantsController_current"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["TenantsController_update"];
        trace?: never;
    };
    "/v1/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["MembersController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/members/invite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MembersController_invite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["MembersController_remove"];
        options?: never;
        head?: never;
        patch: operations["MembersController_update"];
        trace?: never;
    };
    "/v1/invitations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["MembersController_revoke"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invitations/{id}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["MembersController_accept"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/audit-log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuditLogController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ConnectionsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/bosta": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ConnectionsController_saveBosta"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/integrations/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["IntegrationsAdminController_health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/integrations/dead-letters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["IntegrationsAdminController_deadLetters"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/integrations/jobs/{id}/replay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IntegrationsAdminController_replay"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/integrations/cities/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IntegrationsAdminController_resolveCity"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/shopify/install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ShopifyConnectController_install"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/shopify/claim": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ShopifyConnectController_claim"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/{id}/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["StoreSyncController_get"];
        put: operations["StoreSyncController_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/woocommerce": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["WooCommerceConnectController_connect"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/woocommerce/authorize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["WooCommerceConnectController_authorize"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/privacy-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PrivacyController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/privacy-requests/{id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["PrivacyController_export"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AcceptedInvitation: {
            /** Format: uuid */
            tenantId: string;
            /** @enum {string} */
            role: "owner" | "admin" | "ops_manager" | "agent" | "warehouse" | "finance" | "media_buyer";
        };
        AddStaff: {
            /**
             * Format: email
             * @description A Mizan user who has signed in once
             */
            email: string;
            /** @enum {string} */
            role: "super_admin" | "support" | "finance" | "engineer";
        };
        AddStoreNote: {
            body: string;
        };
        AdSpendImported: {
            rows: number;
            /** @description Days whose spend was replaced by the file */
            days: number;
        };
        AdSpendList: {
            from: string;
            to: string;
            baseCurrency: string;
            total: {
                amount: string;
                currency: string;
            };
            /** @description Spend on days with no order to carry it: still a cost, shown, never hidden */
            unallocated: {
                amount: string;
                currency: string;
            };
            byPlatform: {
                /** @enum {string} */
                platform: "meta" | "tiktok" | "google" | "snapchat" | "other";
                spend: {
                    amount: string;
                    currency: string;
                };
            }[];
            days: {
                day: string;
                /** Format: uuid */
                connectionId: string;
                /** @description The day's spend in the base currency */
                spend: {
                    amount: string;
                    currency: string;
                };
                /** @description Orders that share it (placed that day, not cancelled before shipping) */
                orders: number;
                /** @description Each order's share (null when no order shares it: unallocated) */
                perOrder: {
                    amount: string;
                    currency: string;
                } | null;
                /** @description Some spend is in a currency without a rate that day; not counted */
                fxMissing: boolean;
            }[];
            data: {
                day: string;
                /** @enum {string} */
                platform: "meta" | "tiktok" | "google" | "snapchat" | "other";
                campaign: string | null;
                spend: {
                    amount: string;
                    currency: string;
                };
                /** @enum {string} */
                source: "manual" | "csv" | "api";
                /** Format: uuid */
                connectionId: string;
                updatedAt: string;
            }[];
        };
        AdSpendSet: {
            day: string;
            /** @enum {string} */
            platform: "meta" | "tiktok" | "google" | "snapchat" | "other";
            spend: {
                amount: string;
                currency: string;
            };
            /** Format: uuid */
            connectionId: string;
        };
        AgentAnswer: {
            /** @enum {string} */
            answer: "confirm" | "cancel";
            /** @enum {string} */
            reason?: "changed_mind" | "ordered_by_mistake" | "found_cheaper" | "delivery_too_late" | "other";
            note?: string;
            /** @description Answered on a team call (counts for the call channel) */
            byCall?: boolean;
        };
        AnswerResult: {
            outcome: string;
        };
        AuditLogPage: {
            data: {
                /** @description Increasing id; use as cursor */
                id: string;
                /** @description For example "member.removed" */
                action: string;
                actor: {
                    type: string;
                    id: string | null;
                    displayName: string | null;
                };
                entity: {
                    type: string;
                    id: string;
                } | null;
                before: unknown;
                after: unknown;
                ip: string | null;
                /** Format: date-time */
                createdAt: string;
            }[];
            nextCursor: string | null;
        };
        Automation: {
            /** Format: uuid */
            id: string;
            name: string;
            description: string | null;
            /** @description The built-in recipe it was installed from */
            recipe: string | null;
            trigger: string;
            /** @description As saved (see AutomationInput.conditions) */
            conditions: unknown;
            steps: {
                action: string;
                params: {
                    [key: string]: unknown;
                };
            }[];
            enabled: boolean;
            /**
             * @description errors: too many recent runs failed; fix and turn it on again
             * @enum {string|null}
             */
            pausedReason: "errors" | null;
            version: number;
            stats: {
                runs: number;
                failures: number;
                /** Format: date-time */
                lastRunAt: string | null;
            };
            /** Format: date-time */
            updatedAt: string;
        };
        AutomationCatalog: {
            triggers: {
                event: string;
                /** @enum {string} */
                context: "order" | "item" | "none";
            }[];
            fields: {
                event: {
                    field: string;
                    type: string;
                }[];
                order: {
                    field: string;
                    type: string;
                }[];
                item: {
                    field: string;
                    type: string;
                }[];
            };
            operators: string[];
            actions: {
                action: string;
                /** @enum {string} */
                needs: "order" | "none";
                params: unknown;
            }[];
            guards: {
                maxDepth: number;
                errorPause: {
                    minRuns: number;
                    rate: number;
                };
            };
        };
        AutomationDetail: {
            /** Format: uuid */
            id: string;
            name: string;
            description: string | null;
            /** @description The built-in recipe it was installed from */
            recipe: string | null;
            trigger: string;
            /** @description As saved (see AutomationInput.conditions) */
            conditions: unknown;
            steps: {
                action: string;
                params: {
                    [key: string]: unknown;
                };
            }[];
            enabled: boolean;
            /**
             * @description errors: too many recent runs failed; fix and turn it on again
             * @enum {string|null}
             */
            pausedReason: "errors" | null;
            version: number;
            stats: {
                runs: number;
                failures: number;
                /** Format: date-time */
                lastRunAt: string | null;
            };
            /** Format: date-time */
            updatedAt: string;
            /** @description The last 50 runs, newest first */
            runs: {
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                at: string;
                event: string;
                /** Format: uuid */
                entityId: string | null;
                /** @enum {string} */
                status: "skipped" | "succeeded" | "failed";
                /** @description skipped: conditions, loop_guard, invalid_conditions; failed: the step's error */
                reason: string | null;
                version: number;
                depth: number;
                steps: {
                    action: string;
                    result: string;
                    detail?: string;
                }[];
            }[];
        };
        AutomationInput: {
            name: string;
            description?: string;
            /** @description An event from GET /v1/catalog, e.g. order.scored */
            trigger: string;
            /**
             * @description ALL of / ANY of rules { field, op, value }, nested one level
             * @default {
             *       "all": []
             *     }
             */
            conditions: {
                all: ({
                    field: string;
                    /** @enum {string} */
                    op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "exists" | "not_exists";
                    value?: (string | number | boolean) | (string | number | boolean)[];
                } | ({
                    all: {
                        field: string;
                        /** @enum {string} */
                        op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "exists" | "not_exists";
                        value?: (string | number | boolean) | (string | number | boolean)[];
                    }[];
                } | {
                    any: {
                        field: string;
                        /** @enum {string} */
                        op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "exists" | "not_exists";
                        value?: (string | number | boolean) | (string | number | boolean)[];
                    }[];
                }))[];
            } | {
                any: ({
                    field: string;
                    /** @enum {string} */
                    op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "exists" | "not_exists";
                    value?: (string | number | boolean) | (string | number | boolean)[];
                } | ({
                    all: {
                        field: string;
                        /** @enum {string} */
                        op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "exists" | "not_exists";
                        value?: (string | number | boolean) | (string | number | boolean)[];
                    }[];
                } | {
                    any: {
                        field: string;
                        /** @enum {string} */
                        op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "exists" | "not_exists";
                        value?: (string | number | boolean) | (string | number | boolean)[];
                    }[];
                }))[];
            };
            /** @description Actions run in order; one failing stops the rest */
            steps: {
                /** @enum {string} */
                action: "order.add_tag" | "order.assign" | "notify.team";
                /** @default {} */
                params: {
                    [key: string]: unknown;
                };
            }[];
            /** @default false */
            enabled: boolean;
        };
        AutomationList: {
            data: {
                /** Format: uuid */
                id: string;
                name: string;
                description: string | null;
                /** @description The built-in recipe it was installed from */
                recipe: string | null;
                trigger: string;
                /** @description As saved (see AutomationInput.conditions) */
                conditions: unknown;
                steps: {
                    action: string;
                    params: {
                        [key: string]: unknown;
                    };
                }[];
                enabled: boolean;
                /**
                 * @description errors: too many recent runs failed; fix and turn it on again
                 * @enum {string|null}
                 */
                pausedReason: "errors" | null;
                version: number;
                stats: {
                    runs: number;
                    failures: number;
                    /** Format: date-time */
                    lastRunAt: string | null;
                };
                /** Format: date-time */
                updatedAt: string;
            }[];
        };
        AutomationPatch: {
            enabled: boolean;
        };
        BostaKey: {
            /** @description From Bosta's dashboard (Settings → API integration); stored encrypted, never shown again */
            apiKey: string;
        };
        BulkAction: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            action: "assign" | "tag" | "confirm" | "cancel" | "ship";
            /** @enum {string} */
            status: "running" | "done";
            total: number;
            done: number;
            skipped: number;
            failed: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            finishedAt: string | null;
            /** @description Orders skipped or failed and why (200 at most) */
            issues: {
                /** Format: uuid */
                orderId: string;
                number: string;
                /** @enum {string} */
                status: "skipped" | "failed";
                /** @description cancelled, unchanged, shipped, paid_needs_refund, already_confirmed, duplicate_suspected, not_found, already_shipping, not_confirmed, address_missing, payment_blocks_shipping, error… */
                reason: string;
            }[];
        };
        BulkRequest: {
            /** @enum {string} */
            action: "assign";
            /** @description Up to 500 orders */
            orderIds: string[];
            /**
             * Format: uuid
             * @description A team member, or null to unassign
             */
            userId: string | null;
        } | {
            /** @enum {string} */
            action: "tag";
            /** @description Up to 500 orders */
            orderIds: string[];
            /** @description Added (in Shopify too); never removed */
            tags: string[];
        } | {
            /** @enum {string} */
            action: "confirm";
            /** @description Up to 500 orders */
            orderIds: string[];
        } | {
            /** @enum {string} */
            action: "cancel";
            /** @description Up to 500 orders */
            orderIds: string[];
            /** @enum {string} */
            reason: "customer_cancelled" | "duplicate" | "out_of_stock" | "fraud" | "other";
        } | {
            /** @enum {string} */
            action: "ship";
            /** @description Up to 500 orders */
            orderIds: string[];
        };
        CallQueue: {
            /** @description Due now: mine and nobody's */
            waiting: number;
            /** @description Due now and already mine */
            mine: number;
            /** @description Called, no answer: waiting for the retry time */
            later: number;
            /**
             * Format: date-time
             * @description The next retry time
             */
            nextAt: string | null;
            /** @description Every try used; still on the list */
            unreachable: number;
        };
        CallQueueNext: {
            /** @description Claimed for the caller (assigned to them); null when nothing is due */
            order: {
                /** Format: uuid */
                id: string;
                number: string;
                attempts: number;
                unreachable: boolean;
            } | null;
        };
        CatalogVariant: {
            /** Format: uuid */
            id: string;
            title: string | null;
            sku: string;
            barcode: string | null;
            /**
             * @description store: follows the store's barcode on every sync; mizan: set here, syncs leave it alone
             * @enum {string}
             */
            barcodeOwner: "store" | "mizan";
            price: {
                amount: string;
                currency: string;
            };
            compareAt: {
                amount: string;
                currency: string;
            } | null;
            /** @description null until entered; 0 is a real cost */
            cost: {
                amount: string;
                currency: string;
            } | null;
            /** @description Stock as the store last reported it; null = not known */
            available: number | null;
        };
        ChangePlan: {
            /** @enum {string} */
            plan: "free" | "growth" | "scale" | "enterprise";
            reason?: string;
        };
        CityResolved: {
            /** @enum {boolean} */
            saved: true;
            replayed: boolean;
        };
        CompleteRefund: {
            /** @description The transfer or gateway reference */
            reference?: string;
            note?: string;
        };
        ConfirmationLink: {
            /** @description The customer's confirm link */
            url: string;
            /** Format: date-time */
            expiresAt: string;
            /** @description wa.me link with the message, to send by hand */
            whatsappUrl: string | null;
        };
        ConfirmationSettings: {
            /** @description Start a confirmation for every new cash-on-delivery order */
            enabled: boolean;
            steps: {
                /** @enum {string} */
                channel: "whatsapp" | "call_auto" | "call_team";
                /** @description How long to wait for an answer before the next step */
                waitMinutes: number;
            }[];
            callingHours: {
                start: string;
                end: string;
            };
            teamCalls: {
                /** @description How many times the team tries before the order stays on the list as unreachable */
                attempts: number;
                /** @description After "no answer", when the order comes back on the list */
                retryMinutes: number;
            };
            /** @description How long a hand-sent confirm link works */
            linkHours: number;
            /** @description The store's own wording for the chat replies and the call script (E6-5) */
            script?: {
                /**
                 * @description The starting wording: egyptian (default) or formal Arabic
                 * @enum {string}
                 */
                pack: "egyptian" | "formal";
                /** @description The owner's own wording per message and language; empty = the pack's */
                texts: {
                    ar: {
                        confirmed?: string;
                        change_prompt?: string;
                        change_received?: string;
                        cancel_prompt?: string;
                        cancelled?: string;
                        call?: string;
                    };
                    en: {
                        confirmed?: string;
                        change_prompt?: string;
                        change_received?: string;
                        cancel_prompt?: string;
                        cancelled?: string;
                        call?: string;
                    };
                };
            };
            routing: {
                /** @description Route each order by its risk score (E6-2); off: every cash order walks the steps above */
                enabled: boolean;
                /** @description Cash orders scored at or below: confirmed without asking */
                autoMax: number;
                /** @description At or below: asked in the chat (the steps above) */
                botMax: number;
                /** @description At or below: straight to the team's calls; above: held for review (paid orders too) */
                agentMax: number;
            };
        };
        ConfirmationSettingsView: {
            settings: {
                /** @description Start a confirmation for every new cash-on-delivery order */
                enabled: boolean;
                steps: {
                    /** @enum {string} */
                    channel: "whatsapp" | "call_auto" | "call_team";
                    /** @description How long to wait for an answer before the next step */
                    waitMinutes: number;
                }[];
                callingHours: {
                    start: string;
                    end: string;
                };
                teamCalls: {
                    /** @description How many times the team tries before the order stays on the list as unreachable */
                    attempts: number;
                    /** @description After "no answer", when the order comes back on the list */
                    retryMinutes: number;
                };
                /** @description How long a hand-sent confirm link works */
                linkHours: number;
                /** @description The store's own wording for the chat replies and the call script (E6-5) */
                script?: {
                    /**
                     * @description The starting wording: egyptian (default) or formal Arabic
                     * @enum {string}
                     */
                    pack: "egyptian" | "formal";
                    /** @description The owner's own wording per message and language; empty = the pack's */
                    texts: {
                        ar: {
                            confirmed?: string;
                            change_prompt?: string;
                            change_received?: string;
                            cancel_prompt?: string;
                            cancelled?: string;
                            call?: string;
                        };
                        en: {
                            confirmed?: string;
                            change_prompt?: string;
                            change_received?: string;
                            cancel_prompt?: string;
                            cancelled?: string;
                            call?: string;
                        };
                    };
                };
                routing: {
                    /** @description Route each order by its risk score (E6-2); off: every cash order walks the steps above */
                    enabled: boolean;
                    /** @description Cash orders scored at or below: confirmed without asking */
                    autoMax: number;
                    /** @description At or below: asked in the chat (the steps above) */
                    botMax: number;
                    /** @description At or below: straight to the team's calls; above: held for review (paid orders too) */
                    agentMax: number;
                };
            };
            /** @description Channels the store can use for confirmation */
            channels: {
                /** @description The store's WhatsApp number is connected and its template approved */
                whatsapp: boolean;
                /** @description A vendor for automated calls is connected */
                call_auto: boolean;
                /**
                 * @description The store's team can always call
                 * @enum {boolean}
                 */
                call_team: true;
            };
        };
        ConfirmationSummary: {
            days: number;
            /** @description Orders that went through confirmation */
            orders: number;
            /** @description Confirmed (including those shipped or delivered since) */
            confirmed: number;
            cancelled: number;
            /** @description Not answered yet */
            pending: number;
            /** @description Confirmed ÷ (confirmed + cancelled), percent with one decimal; null before anything is decided */
            rate: string | null;
            /** @description Waiting on the team: a team call, a change, a refusal, a hold */
            needsTeam: number;
            /** @description Median minutes from the order to its confirmation, for orders that were asked (auto-confirmed left out) */
            medianMinutes: number | null;
            /** @description By route (E6-2); with routing off every order is bot (the cascade) */
            byRoute: {
                /** @enum {string} */
                route: "auto" | "bot" | "agent" | "hold";
                /** @description Orders that went through confirmation */
                orders: number;
                /** @description Confirmed (including those shipped or delivered since) */
                confirmed: number;
                cancelled: number;
                /** @description Not answered yet */
                pending: number;
                /** @description Confirmed ÷ (confirmed + cancelled), percent with one decimal; null before anything is decided */
                rate: string | null;
            }[];
            /** @description Who got the answer; store = decided outside confirmation (cancelled in the store, for example) */
            byChannel: {
                /** @enum {string} */
                channel: "auto" | "whatsapp" | "link" | "call_team" | "call_auto" | "voice_ai" | "agent" | "store";
                confirmed: number;
                cancelled: number;
            }[];
        };
        Connection: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "store" | "courier" | "whatsapp" | "ads" | "payment" | "tax";
            provider: string;
            account: string | null;
            /** @enum {string} */
            status: "pending" | "active" | "needs_attention" | "disconnected";
            /** @description key_refused, key_lacks_permission, app_uninstalled, scopes_changed … */
            reason: string | null;
            missingScopes: string[];
            /** Format: date-time */
            verifiedAt: string | null;
            /** Format: date-time */
            updatedAt: string;
        };
        Connections: {
            data: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                kind: "store" | "courier" | "whatsapp" | "ads" | "payment" | "tax";
                provider: string;
                account: string | null;
                /** @enum {string} */
                status: "pending" | "active" | "needs_attention" | "disconnected";
                /** @description key_refused, key_lacks_permission, app_uninstalled, scopes_changed … */
                reason: string | null;
                missingScopes: string[];
                /** Format: date-time */
                verifiedAt: string | null;
                /** Format: date-time */
                updatedAt: string;
            }[];
        };
        ConnectionView: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "store" | "courier" | "whatsapp" | "ads" | "payment" | "tax";
            provider: string;
            account: string | null;
            /** @enum {string} */
            status: "pending" | "active" | "needs_attention" | "disconnected";
            /** @description key_refused, key_lacks_permission, app_uninstalled, scopes_changed … */
            reason: string | null;
            missingScopes: string[];
            /** Format: date-time */
            verifiedAt: string | null;
            /** Format: date-time */
            updatedAt: string;
        };
        CostRule: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "agent_per_order" | "packaging_per_order" | "cod_fee_pct" | "payment_fee_pct" | "courier_rate" | "fixed_monthly";
            scope: {
                /** Format: uuid */
                connectionId?: string;
                courier?: string;
                zone?: string;
                method?: string;
                label?: string;
            };
            amount: {
                amount: string;
                currency: string;
            } | null;
            returnAmount: {
                amount: string;
                currency: string;
            } | null;
            pct: string | null;
            fixed: {
                amount: string;
                currency: string;
            } | null;
            /** Format: date */
            validFrom: string;
            /**
             * Format: date
             * @description Last day it applies; null = until changed
             */
            validTo: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        CostRuleList: {
            baseCurrency: string;
            /**
             * Format: date
             * @description Today in the store's time zone
             */
            today: string;
            data: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                kind: "agent_per_order" | "packaging_per_order" | "cod_fee_pct" | "payment_fee_pct" | "courier_rate" | "fixed_monthly";
                scope: {
                    /** Format: uuid */
                    connectionId?: string;
                    courier?: string;
                    zone?: string;
                    method?: string;
                    label?: string;
                };
                amount: {
                    amount: string;
                    currency: string;
                } | null;
                returnAmount: {
                    amount: string;
                    currency: string;
                } | null;
                pct: string | null;
                fixed: {
                    amount: string;
                    currency: string;
                } | null;
                /** Format: date */
                validFrom: string;
                /**
                 * Format: date
                 * @description Last day it applies; null = until changed
                 */
                validTo: string | null;
                /** Format: date-time */
                createdAt: string;
            }[];
        };
        CostsImported: {
            /** @description Variants whose cost was set */
            costs: number;
            /** @description Variants whose barcode was set */
            barcodes: number;
            /** @description Rows with neither a cost nor a barcode */
            skipped: number;
            missingCost: number;
        };
        CostsUpdated: {
            updated: number;
            missingCost: number;
        };
        CourierScorecard: {
            days: number;
            couriers: {
                /** @description Booked in the period */
                shipments: number;
                delivered: number;
                /** @description Returned or on the way back */
                returned: number;
                /** @description Still with the courier */
                inFlight: number;
                /** @description delivered ÷ (delivered + returned), one decimal: the metric layer's formula; null until one ended */
                deliveredRate: string | null;
                rtoRate: string | null;
                /** @description Booked → delivered, in days, one decimal */
                avgDaysToDeliver: string | null;
                courier: string;
                /** @description Most shipments first */
                zones: {
                    /** @description Booked in the period */
                    shipments: number;
                    delivered: number;
                    /** @description Returned or on the way back */
                    returned: number;
                    /** @description Still with the courier */
                    inFlight: number;
                    /** @description delivered ÷ (delivered + returned), one decimal: the metric layer's formula; null until one ended */
                    deliveredRate: string | null;
                    rtoRate: string | null;
                    /** @description Booked → delivered, in days, one decimal */
                    avgDaysToDeliver: string | null;
                    /** @description The governorate (or city when there is none); null when unknown */
                    zone: string | null;
                }[];
            }[];
        };
        CreateAnnouncement: {
            /**
             * @default info
             * @enum {string}
             */
            level: "info" | "warning" | "critical";
            titleAr: string;
            titleEn: string;
            /** @default  */
            bodyAr: string;
            /** @default  */
            bodyEn: string;
            /** Format: uri */
            link?: string;
            /** @description Only stores on these plans; every plan when left out */
            plans?: ("free" | "growth" | "scale" | "enterprise")[];
            /** @description Only stores in these countries */
            countries?: string[];
            /** Format: date-time */
            startsAt?: string;
            /** Format: date-time */
            endsAt: string;
        };
        CreateCostRule: {
            /** @enum {string} */
            kind: "packaging_per_order";
            amount: string;
            /** @default {} */
            scope: {
                /** Format: uuid */
                connectionId?: string;
            };
            /**
             * Format: date
             * @description First day the rule applies (default: today, store time)
             */
            validFrom?: string;
        } | {
            /** @enum {string} */
            kind: "agent_per_order";
            amount: string;
            /** @default {} */
            scope: {
                /** Format: uuid */
                connectionId?: string;
            };
            /**
             * Format: date
             * @description First day the rule applies (default: today, store time)
             */
            validFrom?: string;
        } | {
            /** @enum {string} */
            kind: "cod_fee_pct";
            pct: string;
            /** @default {} */
            scope: {
                courier?: string;
            };
            /**
             * Format: date
             * @description First day the rule applies (default: today, store time)
             */
            validFrom?: string;
        } | {
            /** @enum {string} */
            kind: "payment_fee_pct";
            pct: string;
            /** @description Fixed part per payment, e.g. 2.5% + 2.00 */
            fixed?: string;
            /** @default {} */
            scope: {
                /** @enum {string} */
                method?: "card" | "wallet" | "apple_pay" | "bnpl" | "bank_transfer" | "instapay" | "fawry_ref" | "store_credit" | "cash_pos" | "marketplace";
            };
            /**
             * Format: date
             * @description First day the rule applies (default: today, store time)
             */
            validFrom?: string;
        } | {
            /** @enum {string} */
            kind: "courier_rate";
            /** @description Delivery price */
            amount: string;
            /** @description Price of a return leg */
            returnAmount?: string;
            scope: {
                courier: string;
                zone?: string;
            };
            /**
             * Format: date
             * @description First day the rule applies (default: today, store time)
             */
            validFrom?: string;
        } | {
            /** @enum {string} */
            kind: "fixed_monthly";
            amount: string;
            scope: {
                label: string;
            };
            /**
             * Format: date
             * @description First day the rule applies (default: today, store time)
             */
            validFrom?: string;
        };
        CreateTenant: {
            name: string;
            /** @enum {string} */
            country: "EG" | "SA" | "AE" | "KW" | "QA" | "BH" | "OM" | "JO" | "MA";
            slug?: string;
            /**
             * @default ar
             * @enum {string}
             */
            language: "ar" | "en";
        };
        Dashboard: {
            /** @enum {string} */
            id: "home" | "operations" | "profit" | "payments" | "stock";
            name: string;
            /** Format: date */
            from: string;
            /** Format: date */
            to: string;
            currency: string;
            /** @description The dashboard's metrics the caller may see, from the metric layer */
            tiles: {
                key: string;
                name: string;
                definition: string;
                /** @enum {string} */
                unit: "count" | "percent" | "money" | "days";
                value: string | null;
                money?: {
                    amount: string;
                    currency: string;
                } | null;
            }[];
            /** @description Daily values, every day of the period */
            series: {
                /** @enum {string} */
                key: "orders" | "net_profit";
                name: string;
                /** @enum {string} */
                unit: "count" | "money";
                points: {
                    /** Format: date */
                    day: string;
                    value: string;
                }[];
            }[];
        };
        DashboardList: {
            data: {
                /** @enum {string} */
                id: "home" | "operations" | "profit" | "payments" | "stock";
                name: string;
            }[];
        };
        DeadLetters: {
            data: {
                id: string;
                kind: string;
                provider: string;
                attempts: number;
                error: string | null;
                payload: unknown;
                /** Format: date-time */
                failedAt: string;
            }[];
        };
        DisableUser: {
            /** @description Shown to the stores they belong to */
            reason: string;
        };
        DryRun: {
            /**
             * Format: uuid
             * @description A past event of this trigger
             */
            eventId?: string;
            /**
             * Format: uuid
             * @description Or an order: the trigger's event is imagined for it
             */
            orderId?: string;
        };
        DryRunResult: {
            /** @description The conditions pass */
            matched: boolean;
            rules: {
                field: string;
                /** @enum {string} */
                op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "exists" | "not_exists";
                value: unknown;
                actual: unknown;
                pass: boolean;
            }[];
            /** @description What would run; nothing is done */
            steps: {
                action: string;
                params: {
                    [key: string]: unknown;
                };
                note: string | null;
            }[];
        };
        DuplicateResolved: {
            /** @enum {string} */
            status: "kept" | "merged";
        };
        Exchange: {
            /** Format: uuid */
            id: string;
            original: {
                /** Format: uuid */
                id: string;
                number: string;
            };
            replacement: {
                /** Format: uuid */
                id: string;
                number: string;
                status: string;
            };
            /** @enum {string} */
            reason: "wrong_size" | "wrong_item" | "damaged" | "missing_item" | "not_as_described" | "quality" | "changed_mind" | "late_delivery" | "courier_behaviour" | "not_delivered" | "price" | "other";
            note: string | null;
            /**
             * @description awaiting_return until the return inspection on the original covers every item
             * @enum {string}
             */
            status: "awaiting_return" | "returned";
            items: {
                /** Format: uuid */
                lineId: string;
                title: string;
                quantity: number;
            }[];
            /** @description What the returned items cost the customer */
            returnedValue: {
                amount: string;
                currency: string;
            };
            /** @description Moved to the replacement as store credit (money the customer already paid) */
            credit: {
                amount: string;
                currency: string;
            };
            /** @description The difference the courier collects on the replacement */
            toCollect: {
                amount: string;
                currency: string;
            };
            /** @description Credit left over when the replacement costs less: refund it from the original */
            refundDue: {
                amount: string;
                currency: string;
            };
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            returnedAt: string | null;
        };
        FxRate: {
            quote: string;
            /** @description 1 base = rate quote; null when missing */
            rate: string | null;
            /** @enum {string} */
            source: "manual" | "feed" | "same" | "missing";
            /**
             * Format: date
             * @description Day of the rate used (earlier than asked when stale)
             */
            day: string | null;
            stale: boolean;
        };
        FxRates: {
            base: string;
            /** Format: date */
            day: string;
            /** @description Where daily rates come from (shown with attribution) */
            feed: string | null;
            rates: {
                quote: string;
                /** @description 1 base = rate quote; null when missing */
                rate: string | null;
                /** @enum {string} */
                source: "manual" | "feed" | "same" | "missing";
                /**
                 * Format: date
                 * @description Day of the rate used (earlier than asked when stale)
                 */
                day: string | null;
                stale: boolean;
            }[];
        };
        Health: {
            /** @enum {string} */
            status: "ok";
            version: string;
            uptimeS: number;
            /** Format: date-time */
            time: string;
        };
        Id: {
            /** Format: uuid */
            id: string;
        };
        ImportAdSpend: {
            /** @description The file's text: a header row with date and spend, and platform (or `platform` below), optional currency and campaign */
            csv: string;
            /**
             * @description Platform for every row when the file has no platform column
             * @enum {string}
             */
            platform?: "meta" | "tiktok" | "google" | "snapchat" | "other";
            /** Format: uuid */
            connectionId?: string;
        };
        ImportCosts: {
            /** @description The file's text: a header row with SKU and cost and/or barcode; other columns are ignored */
            csv: string;
        };
        ImportShipmentStatuses: {
            /** @description The courier's report: a header row with the tracking number and the status (canonical, or what couriers write in Arabic or English); date and note optional */
            csv: string;
        };
        Inspect: {
            items: {
                /**
                 * Format: uuid
                 * @description The order line that came back
                 */
                lineId: string;
                quantity: number;
                /**
                 * @description restock: sellable, back into stock; damaged; write_off: thrown away
                 * @enum {string}
                 */
                outcome: "restock" | "damaged" | "write_off";
            }[];
            note?: string;
            /**
             * Format: uuid
             * @description The return or exchange ticket it settles; it must be on the same order
             */
            ticketId?: string;
        };
        InstallRecipe: {
            /**
             * @description Messages in this language (default: the store's)
             * @enum {string}
             */
            language?: "ar" | "en";
        };
        IntegrationsHealth: {
            connected: boolean;
            reason?: string;
            connections: {
                /** Format: uuid */
                id: string;
                kind: string;
                provider: string;
                account: string | null;
                status: string;
                reason: string | null;
                /** Format: date-time */
                updatedAt: string;
            }[];
            /** @description Circuit breaker and rate-limit state */
            shopify?: unknown;
            /** @description Circuit breaker and rate-limit state */
            bosta?: unknown;
            outbox?: {
                pending: number;
                dead: number;
            };
            deadLetters?: {
                id: string;
                kind: string;
                attempts: number;
                error: string | null;
            }[];
            /** @description Provider fields that changed shape (schema drift) */
            drift?: unknown[];
            /** @description Shopify history import progress, or null */
            backfill?: unknown;
        };
        InventorySettings: {
            /** @description Send Mizan's available count of counted items to the store (Shopify), so the store never sells what Mizan has reserved or doesn't have */
            pushToStore: boolean;
        };
        Invitation: {
            /** Format: uuid */
            id: string;
            email: string | null;
            phone: string | null;
            /** @enum {string} */
            role: "owner" | "admin" | "ops_manager" | "agent" | "warehouse" | "finance" | "media_buyer";
            /** @enum {string} */
            status: "pending" | "accepted" | "revoked";
            /** Format: date-time */
            expiresAt: string;
            /** Format: date-time */
            createdAt: string;
            /**
             * Format: uri
             * @description Link to share; opening it still requires signing in with the invited email or phone
             */
            acceptUrl: string;
        };
        Invite: {
            /** Format: email */
            email?: string;
            phone?: string;
            /** @enum {string} */
            role: "owner" | "admin" | "ops_manager" | "agent" | "warehouse" | "finance" | "media_buyer";
        };
        Ledger: {
            /** Format: uuid */
            orderId: string;
            currency: string;
            /** @description The order's payment status */
            status: string;
            total: {
                amount: string;
                currency: string;
            };
            /** @description Σ money-in lines (sale, capture, cash collected) less voids */
            paid: {
                amount: string;
                currency: string;
            };
            /** @description Σ refunds */
            refunded: {
                amount: string;
                currency: string;
            };
            /** @description Chargebacks less reversals */
            chargedBack: {
                amount: string;
                currency: string;
            };
            /** @description What the merchant holds: paid − refunded − charged back */
            net: {
                amount: string;
                currency: string;
            };
            /** @description What the customer still owes */
            balance: {
                amount: string;
                currency: string;
            };
            /** @description Whether the caller may record a payment or refund */
            canRecord: boolean;
            lines: {
                /** Format: uuid */
                id: string;
                /** @description authorization, capture, sale, cod_collection, refund, chargeback, chargeback_reversal, void */
                kind: string;
                method: string;
                /** @description pending, succeeded, failed, cancelled; only succeeded lines count */
                status: string;
                /** @enum {string} */
                source: "store" | "gateway" | "courier" | "manual";
                /** @description Signed: money in positive, money out negative */
                amount: {
                    amount: string;
                    currency: string;
                };
                fee: {
                    amount: string;
                    currency: string;
                } | null;
                feeIsActual: boolean;
                note: string | null;
                /** @description The team member's name, for lines they recorded */
                recordedBy: string | null;
                /** Format: date-time */
                occurredAt: string;
            }[];
        };
        ManualShipment: {
            /** @description The courier's name as the team calls it (J&T, Aramex, our own driver…) */
            courier: string;
            /** @description The courier's tracking or waybill number */
            trackingNumber: string;
        };
        Marked: {
            marked: number;
        };
        MarkRead: {
            ids?: string[];
            /** @enum {boolean} */
            all?: true;
        };
        Me: {
            user: {
                /** Format: uuid */
                id: string;
                firebaseUid: string;
                email: string | null;
                /** @description E.164 */
                phone: string | null;
                displayName: string | null;
                /** @enum {string} */
                language: "ar" | "en";
                emailVerified: boolean;
                /** @description Signed in with a second factor (owners and admins need it in stores) */
                mfa: boolean;
            };
            memberships: {
                /** Format: uuid */
                tenantId: string;
                tenantName: string;
                tenantSlug: string;
                /**
                 * @description Deleted stores are not listed
                 * @enum {string}
                 */
                tenantStatus: "trial" | "active" | "suspended";
                country: string;
                baseCurrency: string;
                locale: string;
                timezone: string;
                /** @enum {string} */
                role: "owner" | "admin" | "ops_manager" | "agent" | "warehouse" | "finance" | "media_buyer";
                /** @enum {string} */
                status: "invited" | "active" | "disabled";
            }[];
            /** @description Pending invitations addressed to my verified email or phone */
            invitations: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                tenantId: string;
                tenantName: string;
                /** @enum {string} */
                role: "owner" | "admin" | "ops_manager" | "agent" | "warehouse" | "finance" | "media_buyer";
                /** Format: date-time */
                expiresAt: string;
            }[];
        };
        Member: {
            /** Format: uuid */
            userId: string;
            displayName: string | null;
            email: string | null;
            /** @description E.164 */
            phone: string | null;
            /** @enum {string} */
            role: "owner" | "admin" | "ops_manager" | "agent" | "warehouse" | "finance" | "media_buyer";
            /** @enum {string} */
            status: "active" | "invited" | "disabled";
            /** Format: date-time */
            joinedAt: string;
        };
        MetricCatalogue: {
            /** @description The metrics the caller may see, in their language */
            data: {
                key: string;
                version: number;
                /** @enum {string} */
                unit: "count" | "percent" | "money" | "days";
                module: string;
                name: string;
                definition: string;
            }[];
        };
        MetricValues: {
            /** Format: date */
            from: string;
            /** Format: date */
            to: string;
            /** @description The store's base currency, for money metrics */
            currency: string;
            data: {
                key: string;
                version: number;
                /** @enum {string} */
                unit: "count" | "percent" | "money" | "days";
                /** @description Decimal string: a count, a percentage with one decimal ("82.4"), an amount, or days; null when it cannot be computed (nothing to divide by) */
                value: string | null;
                money?: {
                    amount: string;
                    currency: string;
                } | null;
                numerator?: string;
                denominator?: string;
            }[];
        };
        Money: {
            amount: string;
            currency: string;
        };
        MovementsRecorded: {
            /** @description Items whose stock changed */
            applied: number;
            levels: {
                /** Format: uuid */
                variantId: string;
                onHand: number;
                reserved: number;
                available: number;
            }[];
            /** @description Orders waiting for stock that are now reserved */
            ordersReserved: number;
        };
        NewExchange: {
            /**
             * Format: uuid
             * @description The delivered order the items come back from
             */
            orderId: string;
            /** @description What comes back */
            items: {
                /** Format: uuid */
                lineId: string;
                quantity: number;
            }[];
            /** @description What the customer gets instead (catalogue products or titled items with a price) */
            lines: {
                /**
                 * Format: uuid
                 * @description A product from the catalogue (its price unless unitPrice is given)
                 */
                variantId?: string;
                /** @description An item not in the catalogue (needs unitPrice) */
                title?: string;
                quantity: number;
                unitPrice?: string;
            }[];
            /**
             * @description What the customer pays for the exchange's shipping (0 when the store pays)
             * @default 0
             */
            shipping: string;
            /** @enum {string} */
            reason: "wrong_size" | "wrong_item" | "damaged" | "missing_item" | "not_as_described" | "quality" | "changed_mind" | "late_delivery" | "courier_behaviour" | "not_delivered" | "price" | "other";
            note?: string;
            /**
             * Format: uuid
             * @description The case this exchange settles
             */
            ticketId?: string;
        };
        NewOrder: {
            /**
             * @description Where the customer ordered
             * @enum {string}
             */
            source: "phone" | "whatsapp" | "instagram" | "facebook" | "tiktok" | "walk_in" | "other";
            customer: {
                name: string;
                /** @description Local or international; checked for the store's country */
                phone: string;
            };
            address: {
                line1: string;
                line2?: string;
                city: string;
                province?: string;
            };
            lines: {
                /**
                 * Format: uuid
                 * @description A product from the catalogue (its price unless unitPrice is given)
                 */
                variantId?: string;
                /** @description An item not in the catalogue (needs unitPrice) */
                title?: string;
                quantity: number;
                unitPrice?: string;
            }[];
            /** @default 0 */
            shipping: string;
            /** @default 0 */
            discount: string;
            payment: {
                /**
                 * @description cod: the courier collects all; prepaid: paid in full; partial: a deposit now, the rest on delivery; bank_transfer: waits for the money unless paid
                 * @enum {string}
                 */
                mode: "cod" | "prepaid" | "partial" | "bank_transfer";
                /**
                 * @description How money already paid came in (prepaid, partial, bank_transfer)
                 * @enum {string}
                 */
                method?: "wallet" | "card" | "instapay";
                /** @description partial: the deposit; prepaid: the total (optional); bank_transfer: the total once it arrived */
                paid?: string;
            };
        };
        NewRefund: {
            /** @description In the order's currency; Arabic digits accepted */
            amount: string;
            /**
             * @description original_method: back the way it came (online payments only); store_credit: to the customer's credit; bank_transfer; cash
             * @enum {string}
             */
            destination: "original_method" | "store_credit" | "bank_transfer" | "cash";
            reason?: string;
            /**
             * Format: uuid
             * @description The ticket this refund settles; it must be on the same order
             */
            ticketId?: string;
        };
        NewTicket: {
            /** @enum {string} */
            type: "complaint" | "exchange" | "refund" | "delivery_issue" | "return" | "refused";
            /** @enum {string} */
            reason?: "wrong_size" | "wrong_item" | "damaged" | "missing_item" | "not_as_described" | "quality" | "changed_mind" | "late_delivery" | "courier_behaviour" | "not_delivered" | "price" | "other";
            /**
             * Format: uuid
             * @description The order it is about
             */
            orderId?: string;
            /** @description Or the order's number as the team sees it (#1042, M-1001) */
            orderNumber?: string;
            /** @description What happened, in the team's words */
            description?: string;
            /**
             * @description Where the case came from
             * @default team
             * @enum {string}
             */
            source: "team" | "whatsapp" | "phone" | "courier" | "automation";
            /** Format: uuid */
            assignedTo?: string;
        };
        NoAnswer: {
            /** @description Team calls tried so far */
            attempts: number;
            max: number;
            /**
             * Format: date-time
             * @description When the order comes back on the call list; null after the last try
             */
            after: string | null;
            unreachable: boolean;
        };
        NotificationList: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                at: string;
                text: string;
                source: string;
                entity: {
                    type: string;
                    /** Format: uuid */
                    id: string;
                } | null;
                read: boolean;
            }[];
            unread: number;
        };
        OfferDecided: {
            /** @enum {string} */
            status: "accepted" | "declined" | "expired";
        };
        OfferDecision: {
            /**
             * @description The customer's answer on the call
             * @enum {string}
             */
            decision: "accept" | "decline";
        };
        OfferProducts: {
            data: {
                /** Format: uuid */
                variantId: string;
                sku: string;
                title: string;
                price: {
                    amount: string;
                    currency: string;
                };
                available: number | null;
            }[];
        };
        OfferRuleCreate: {
            /**
             * Format: uuid
             * @description When the order has this product; null = any order
             */
            triggerVariantId: string | null;
            /**
             * Format: uuid
             * @description The product to offer
             */
            offerVariantId: string;
            /** @default 0 */
            discountPct: string;
            /** @default 0 */
            priority: number;
            /** @description Your wording (else Mizan writes it) */
            messageAr?: string;
            messageEn?: string;
        };
        OfferRuleList: {
            data: {
                /** Format: uuid */
                id: string;
                trigger: {
                    /** Format: uuid */
                    variantId: string;
                    title: string;
                } | null;
                offer: {
                    /** Format: uuid */
                    variantId: string;
                    title: string;
                    price: {
                        amount: string;
                        currency: string;
                    };
                };
                discountPct: string;
                priority: number;
                messageAr: string | null;
                messageEn: string | null;
                active: boolean;
                /** Format: date-time */
                createdAt: string;
            }[];
        };
        OfferRuleUpdate: {
            active: boolean;
        };
        OfferSettings: {
            /** @description Offer one more item when a customer confirms */
            enabled: boolean;
            /**
             * @description rules_then_auto: the owner's rules first, else what is bought together
             * @enum {string}
             */
            mode: "rules_then_auto" | "rules" | "auto";
            /** @description No offer is ever discounted more than this */
            maxDiscountPct: string;
            /** @description Discount on recommended offers (rules carry their own) */
            autoDiscountPct: string;
            /** @description Offer in the WhatsApp chat right after the customer confirms */
            inWhatsApp: boolean;
            /** @description Show the offer in the team's call script */
            inCalls: boolean;
            /** @description Let Claude choose among Mizan's candidates and write the message (no customer data is sent) */
            ai: boolean;
        };
        OfferSummary: {
            days: number;
            offered: number;
            accepted: number;
            declined: number;
            /** @description What accepted offers added, per currency */
            added: {
                amount: string;
                currency: string;
            }[];
        };
        Onboarding: {
            steps: {
                store: {
                    /** @enum {string} */
                    status: "todo" | "done";
                    /** Format: uuid */
                    connectionId: string | null;
                    shop: string | null;
                    import: {
                        /** @enum {string} */
                        status: "running" | "done";
                        /** @enum {string} */
                        phase: "orders" | "products" | "done";
                        orders: number;
                        products: number;
                    } | null;
                    missingScopes: string[];
                };
                courier: {
                    /** @enum {string} */
                    status: "todo" | "checking" | "done" | "needs_attention" | "skipped";
                    provider: string | null;
                    /** @description key_refused, key_lacks_permission */
                    reason: string | null;
                };
                costs: {
                    /** @enum {string} */
                    status: "todo" | "done" | "skipped";
                    variants: number;
                    missingCost: number;
                };
                firstOrder: {
                    /** @enum {string} */
                    status: "waiting" | "done";
                    /** Format: uuid */
                    orderId: string | null;
                    number: string | null;
                    total: {
                        amount: string;
                        currency: string;
                    } | null;
                    /** Format: date-time */
                    at: string | null;
                };
            };
            milestones: {
                /** Format: date-time */
                signup: string | null;
                /** Format: date-time */
                storeConnected: string | null;
                /** Format: date-time */
                courierConnected: string | null;
                /** Format: date-time */
                costsEntered: string | null;
                /** Format: date-time */
                firstOrderSynced: string | null;
            };
            timeToFirstValueS: number | null;
            complete: boolean;
            dismissed: boolean;
        };
        OpenSupportAccess: {
            /** @description Why; shown to the store */
            reason: string;
            /**
             * @description Until it ends by itself (at most 8 hours)
             * @default 60
             */
            minutes: number;
            /**
             * @description write needs a super admin
             * @default read
             * @enum {string}
             */
            mode: "read" | "write";
        };
        OpsSync: {
            /** @description The phone's install id, as the app made it */
            deviceId: string;
            ops: {
                /** @description Made by the app once per operation (a UUID or ULID); a replay with the same opId changes nothing */
                opId: string;
                /** @description One of: stock.receive, stock.count, stock.adjust, return.inspect */
                type: string;
                payload: {
                    [key: string]: unknown;
                };
                /**
                 * Format: date-time
                 * @description When it happened on the phone; ops are applied in this order
                 */
                at: string;
            }[];
        };
        OpsSyncResult: {
            /** Format: date-time */
            serverTime: string;
            /** @description In the order the ops were sent */
            results: {
                opId: string;
                /**
                 * @description applied now; duplicate: already synced (see original); rejected: can never apply (fix and send a new op); conflict: the server's stock wins, tell the user
                 * @enum {string}
                 */
                status: "applied" | "duplicate" | "rejected" | "conflict";
                /**
                 * @description For a duplicate: what happened the first time
                 * @enum {string|null}
                 */
                original: "applied" | "rejected" | "conflict" | null;
                /** @description unknown_type, invalid_payload, unknown_item, below_reserved… */
                code: string | null;
                message: string | null;
                /** @description For applied stock ops: the item's levels after it */
                result: {
                    [key: string]: unknown;
                } | null;
            }[];
        };
        OrderConfirmation: {
            run: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                status: "running" | "confirmed" | "cancelled" | "needs_agent" | "stopped";
                outcome: string | null;
                reason: string | null;
                answeredChannel: string | null;
                plan: {
                    /** @enum {string} */
                    channel: "whatsapp" | "call_auto" | "call_team";
                    waitMinutes: number;
                }[];
                step: number;
                /** Format: date-time */
                startedAt: string;
                /** Format: date-time */
                finishedAt: string | null;
                /** Format: date-time */
                linkExpiresAt: string;
                next: {
                    channel: string;
                    /** @enum {string} */
                    kind: "send" | "timeout";
                    /** Format: date-time */
                    at: string;
                } | null;
                calls: {
                    attempts: number;
                    max: number;
                    /**
                     * Format: date-time
                     * @description Back on the call list at
                     */
                    after: string | null;
                };
            } | null;
            steps: {
                idx: number;
                channel: string;
                status: string;
                /** Format: date-time */
                at: string;
            }[];
            attempts: {
                channel: string;
                outcome: string | null;
                /** Format: date-time */
                at: string;
            }[];
            whatsapp: {
                /** @enum {string} */
                direction: "in" | "out";
                /** @description out: template, list, text; in: quick_reply, button_reply, list_reply, text, location */
                kind: string;
                /** @description out: ask or the reply sent; in: confirm, change, cancel, reason, keep, note, message, late, ignored, opt_out, opt_in */
                action: string | null;
                status: string;
                errorCode: number | null;
                /** Format: date-time */
                at: string;
            }[];
            optedOut: boolean;
            script: string[];
            offer: {
                /** Format: uuid */
                id: string;
                title: string;
                qty: number;
                /** @description Before the discount */
                unitPrice: {
                    amount: string;
                    currency: string;
                };
                /** @description For one, after the discount: what the customer was shown */
                offerPrice: {
                    amount: string;
                    currency: string;
                };
                discountPct: string;
                /** @enum {string} */
                source: "rule" | "auto" | "ai";
                /** @enum {string} */
                status: "proposed" | "accepted" | "declined" | "expired" | "applying" | "applied" | "failed";
                messageAr: string | null;
                messageEn: string | null;
                /**
                 * @description Why it was not added to the store's order: not_in_store (manual order or unlinked product), unavailable (sold out, removed, order cancelled), permission (reconnect the store), failed
                 * @enum {string|null}
                 */
                failure: "not_in_store" | "unavailable" | "permission" | "failed" | null;
            } | null;
            /** @description Channels the store can use for confirmation */
            channels: {
                /** @description The store's WhatsApp number is connected and its template approved */
                whatsapp: boolean;
                /** @description A vendor for automated calls is connected */
                call_auto: boolean;
                /**
                 * @description The store's team can always call
                 * @enum {boolean}
                 */
                call_team: true;
            };
        };
        OrderCreated: {
            /** Format: uuid */
            id: string;
            number: string;
            /** @enum {string} */
            status: "new" | "pending_confirmation" | "confirmed" | "cancelled" | "shipped" | "delivered" | "returned";
        };
        OrderDetail: {
            /** Format: uuid */
            id: string;
            number: string;
            /** @enum {string} */
            status: "new" | "pending_confirmation" | "confirmed" | "cancelled" | "shipped" | "delivered" | "returned";
            channel: string;
            store: {
                /** Format: uuid */
                connectionId: string | null;
                provider: string | null;
            };
            customer: {
                /** @description "Mona A." */
                label: string | null;
                phoneLast4: string | null;
            };
            total: {
                amount: string;
                currency: string;
            };
            /** @description Cash the courier collects; from cashToCollect, never the total */
            cod: {
                amount: string;
                currency: string;
            };
            /** @enum {string} */
            paymentMode: "cod" | "prepaid" | "partial" | "bnpl" | "bank_transfer" | "store_credit" | "mixed" | "unknown";
            /** @enum {string} */
            paymentStatus: "unpaid" | "authorized" | "partially_paid" | "paid" | "partially_refunded" | "refunded" | "disputed" | "failed" | "voided";
            risk: number | null;
            tags: string[];
            /** Format: date-time */
            placedAt: string;
            /**
             * @description A likely duplicate of an earlier order of the same customer (E5-3)
             * @enum {string|null}
             */
            duplicate: "suspected" | "kept" | "merged" | null;
            /**
             * @description Confirmed orders: reserved, short (waiting for stock) or untracked (no item counted in Mizan); null otherwise (E8-2)
             * @enum {string|null}
             */
            stock: "reserved" | "short" | "untracked" | null;
            externalId: string | null;
            currency: string;
            subtotal: {
                amount: string;
                currency: string;
            };
            shipping: {
                amount: string;
                currency: string;
            };
            discount: {
                amount: string;
                currency: string;
            };
            paid: {
                amount: string;
                currency: string;
            };
            refunded: {
                amount: string;
                currency: string;
            };
            /** @description Still owed by the customer: total − paid, never below zero */
            balance: {
                amount: string;
                currency: string;
            };
            area: {
                city: string | null;
                province: string | null;
                country: string | null;
            };
            /** @description A map pin exists (shown on reveal) */
            hasLocation: boolean;
            riskReasons: string[];
            /** Format: uuid */
            assignedTo: string | null;
            /** @description Personal data deleted at the customer's or store's request */
            redacted: boolean;
            timestamps: {
                /** Format: date-time */
                placedAt: string;
                /** Format: date-time */
                confirmedAt: string | null;
                /** Format: date-time */
                shippedAt: string | null;
                /** Format: date-time */
                deliveredAt: string | null;
                /** Format: date-time */
                cancelledAt: string | null;
            };
            lines: {
                /** Format: uuid */
                id: string;
                sku: string | null;
                title: string;
                quantity: number;
                unitPrice: {
                    amount: string;
                    currency: string;
                };
                total: {
                    amount: string;
                    currency: string;
                };
                /** Format: uuid */
                variantId: string | null;
            }[];
            payments: {
                /** Format: uuid */
                id: string;
                kind: string;
                method: string;
                status: string;
                amount: {
                    amount: string;
                    currency: string;
                };
                /** Format: date-time */
                occurredAt: string;
            }[];
            shipments: {
                /** Format: uuid */
                id: string;
                provider: string;
                trackingNumber: string | null;
                status: string;
                /** Format: date-time */
                statusAt: string | null;
                cod: {
                    amount: string;
                    currency: string;
                };
                /**
                 * @description E7-1: pending while the courier is booked; failed with errorCode
                 * @enum {string}
                 */
                booking: "pending" | "booked" | "failed";
                /** @description Why the booking failed: city_unknown, address_invalid, payment_blocks, cancelled, not_found, courier_refused_key, courier_failed */
                errorCode: string | null;
                trackingUrl: string | null;
            }[];
            partialDelivery: {
                due: {
                    amount: string;
                    currency: string;
                };
                items: {
                    /** Format: uuid */
                    lineId: string;
                    quantity: number;
                }[];
                /** Format: date-time */
                at: string;
            } | null;
            refusal: {
                reason: string;
                openBox: boolean;
                /** Format: date-time */
                at: string;
            } | null;
            duplicateOf: {
                /** Format: uuid */
                id: string;
                number: string;
                /** @enum {string} */
                status: "new" | "pending_confirmation" | "confirmed" | "cancelled" | "shipped" | "delivered" | "returned";
                /** @description Products in both orders */
                items: string[];
                minutesApart: number;
            } | null;
            events: {
                /** Format: uuid */
                id: string;
                /** @description created, updated, payment_changed, awaiting_payment, … */
                type: string;
                fromStatus: string | null;
                toStatus: string | null;
                /** @enum {string} */
                actorType: "user" | "system" | "automation" | "customer" | "courier";
                /** Format: date-time */
                at: string;
                data: {
                    source?: string;
                    channel?: string;
                    changed?: string[];
                    reason?: string;
                    from?: string;
                    to?: string;
                    /** @description duplicate_found / duplicate_kept: the earlier order's number */
                    of?: string;
                    /** @description duplicate_merged: the order it was merged into */
                    into?: string;
                    /** @description shipment_status: the courier's status (canonical) */
                    status?: string;
                };
            }[];
        };
        OrderExchanges: {
            /** @description Exchanges made from this order */
            outgoing: {
                /** Format: uuid */
                id: string;
                original: {
                    /** Format: uuid */
                    id: string;
                    number: string;
                };
                replacement: {
                    /** Format: uuid */
                    id: string;
                    number: string;
                    status: string;
                };
                /** @enum {string} */
                reason: "wrong_size" | "wrong_item" | "damaged" | "missing_item" | "not_as_described" | "quality" | "changed_mind" | "late_delivery" | "courier_behaviour" | "not_delivered" | "price" | "other";
                note: string | null;
                /**
                 * @description awaiting_return until the return inspection on the original covers every item
                 * @enum {string}
                 */
                status: "awaiting_return" | "returned";
                items: {
                    /** Format: uuid */
                    lineId: string;
                    title: string;
                    quantity: number;
                }[];
                /** @description What the returned items cost the customer */
                returnedValue: {
                    amount: string;
                    currency: string;
                };
                /** @description Moved to the replacement as store credit (money the customer already paid) */
                credit: {
                    amount: string;
                    currency: string;
                };
                /** @description The difference the courier collects on the replacement */
                toCollect: {
                    amount: string;
                    currency: string;
                };
                /** @description Credit left over when the replacement costs less: refund it from the original */
                refundDue: {
                    amount: string;
                    currency: string;
                };
                /** Format: date-time */
                createdAt: string;
                /** Format: date-time */
                returnedAt: string | null;
            }[];
            /** @description When this order is a replacement: the exchange it settles */
            exchangeOf: {
                /** Format: uuid */
                id: string;
                original: {
                    /** Format: uuid */
                    id: string;
                    number: string;
                };
                replacement: {
                    /** Format: uuid */
                    id: string;
                    number: string;
                    status: string;
                };
                /** @enum {string} */
                reason: "wrong_size" | "wrong_item" | "damaged" | "missing_item" | "not_as_described" | "quality" | "changed_mind" | "late_delivery" | "courier_behaviour" | "not_delivered" | "price" | "other";
                note: string | null;
                /**
                 * @description awaiting_return until the return inspection on the original covers every item
                 * @enum {string}
                 */
                status: "awaiting_return" | "returned";
                items: {
                    /** Format: uuid */
                    lineId: string;
                    title: string;
                    quantity: number;
                }[];
                /** @description What the returned items cost the customer */
                returnedValue: {
                    amount: string;
                    currency: string;
                };
                /** @description Moved to the replacement as store credit (money the customer already paid) */
                credit: {
                    amount: string;
                    currency: string;
                };
                /** @description The difference the courier collects on the replacement */
                toCollect: {
                    amount: string;
                    currency: string;
                };
                /** @description Credit left over when the replacement costs less: refund it from the original */
                refundDue: {
                    amount: string;
                    currency: string;
                };
                /** Format: date-time */
                createdAt: string;
                /** Format: date-time */
                returnedAt: string | null;
            } | null;
        };
        OrderPage: {
            data: {
                /** Format: uuid */
                id: string;
                number: string;
                /** @enum {string} */
                status: "new" | "pending_confirmation" | "confirmed" | "cancelled" | "shipped" | "delivered" | "returned";
                channel: string;
                store: {
                    /** Format: uuid */
                    connectionId: string | null;
                    provider: string | null;
                };
                customer: {
                    /** @description "Mona A." */
                    label: string | null;
                    phoneLast4: string | null;
                };
                total: {
                    amount: string;
                    currency: string;
                };
                /** @description Cash the courier collects; from cashToCollect, never the total */
                cod: {
                    amount: string;
                    currency: string;
                };
                /** @enum {string} */
                paymentMode: "cod" | "prepaid" | "partial" | "bnpl" | "bank_transfer" | "store_credit" | "mixed" | "unknown";
                /** @enum {string} */
                paymentStatus: "unpaid" | "authorized" | "partially_paid" | "paid" | "partially_refunded" | "refunded" | "disputed" | "failed" | "voided";
                risk: number | null;
                tags: string[];
                /** Format: date-time */
                placedAt: string;
                /**
                 * @description A likely duplicate of an earlier order of the same customer (E5-3)
                 * @enum {string|null}
                 */
                duplicate: "suspected" | "kept" | "merged" | null;
                /**
                 * @description Confirmed orders: reserved, short (waiting for stock) or untracked (no item counted in Mizan); null otherwise (E8-2)
                 * @enum {string|null}
                 */
                stock: "reserved" | "short" | "untracked" | null;
            }[];
            nextCursor: string | null;
            counts: {
                all: number;
                new: number;
                pending_confirmation: number;
                confirmed: number;
                cancelled: number;
                shipped: number;
                delivered: number;
                returned: number;
            };
            needsCall: number;
            duplicates: number;
            waitingStock: number;
            /** @description Confirmed orders ready for the courier (E7-2) */
            readyToShip: number;
        };
        OrderPnl: {
            currency: string;
            /**
             * Format: date
             * @description The order's day, store time (rules and rate of that day)
             */
            day: string | null;
            /** @description Final once settled or inspected; provisional before */
            isFinal: boolean;
            /** @description fx_missing, ads_fx_missing, cost_missing, shipping_rate_missing, cod_fee_missing, payment_fee_missing, agent_cost_missing, packaging_cost_missing, return_rate_missing, estimated, awaiting_settlement */
            flags: string[];
            /** Format: date-time */
            computedAt: string;
            revenue: {
                amount: string;
                currency: string;
            };
            refunds: {
                amount: string;
                currency: string;
            };
            productCost: {
                amount: string;
                currency: string;
            };
            shipping: {
                amount: string;
                currency: string;
            };
            codFee: {
                amount: string;
                currency: string;
            };
            paymentFee: {
                amount: string;
                currency: string;
            };
            channelFee: {
                amount: string;
                currency: string;
            };
            ads: {
                amount: string;
                currency: string;
            };
            agent: {
                amount: string;
                currency: string;
            };
            packaging: {
                amount: string;
                currency: string;
            };
            returns: {
                amount: string;
                currency: string;
            };
            chargebacks: {
                amount: string;
                currency: string;
            };
            /** @description Realised profit so far */
            net: {
                amount: string;
                currency: string;
            };
            expectedRevenue: {
                amount: string;
                currency: string;
            };
            /** @description Profit if the order delivers (orders still moving); equals net otherwise */
            expectedNet: {
                amount: string;
                currency: string;
            };
        };
        OrderProducts: {
            data: {
                /** Format: uuid */
                variantId: string;
                sku: string | null;
                title: string;
                price: {
                    amount: string;
                    currency: string;
                };
                available: number | null;
            }[];
        };
        OrderSettings: {
            /** @description An order of the same customer with the same product within this many hours of another is a likely duplicate; 0 turns detection off (at most 7 days) */
            duplicateWindowHours: number;
        };
        PartialDelivered: {
            /** Format: uuid */
            orderId: string;
            status: string;
            /** @description What the customer owes now: the kept items, plus shipping, less discount */
            due: {
                amount: string;
                currency: string;
            };
            /** @description Cash the courier collected (in the ledger) */
            collected: {
                amount: string;
                currency: string;
            };
            /** @description Paid beforehand beyond what they kept */
            refundDue: {
                amount: string;
                currency: string;
            };
            kept: {
                /** Format: uuid */
                lineId: string;
                title: string;
                quantity: number;
            }[];
            /** @description Inspect these when they arrive (return inspection) */
            comingBack: {
                /** Format: uuid */
                lineId: string;
                title: string;
                quantity: number;
            }[];
        };
        PartialDelivery: {
            /** @description What the customer kept; the rest comes back */
            kept: {
                /** Format: uuid */
                lineId: string;
                quantity: number;
            }[];
            /** @description Cash the courier collected (default: what the kept items still owe) */
            collected?: string;
            note?: string;
        };
        PaymentMix: {
            days: number;
            /** @description Orders placed in the period, cancelled ones left out */
            orders: number;
            modes: {
                /** @enum {string} */
                mode: "cod" | "prepaid" | "partial" | "bnpl" | "bank_transfer" | "unknown";
                orders: number;
                /** @description Share of the period's orders, one decimal */
                pct: number;
            }[];
            /** @description Money in during the period by method, net of voids, per currency */
            received: {
                method: string;
                amount: {
                    amount: string;
                    currency: string;
                };
            }[];
        };
        PaymentPage: {
            data: {
                order: {
                    /** Format: uuid */
                    id: string;
                    number: string;
                    status: string;
                    /** Format: date-time */
                    placedAt: string;
                };
                /** @enum {string} */
                mode: "cod" | "prepaid" | "partial" | "bnpl" | "bank_transfer" | "unknown";
                /** @enum {string} */
                status: "unpaid" | "authorized" | "partially_paid" | "paid" | "partially_refunded" | "refunded" | "voided" | "failed" | "disputed" | "unknown";
                /** @description Methods in the order's ledger (card, wallet, instapay…) */
                methods: string[];
                total: {
                    amount: string;
                    currency: string;
                };
                paid: {
                    amount: string;
                    currency: string;
                };
                refunded: {
                    amount: string;
                    currency: string;
                };
                /** @description What the customer still owes */
                balance: {
                    amount: string;
                    currency: string;
                };
                /** @description Cash the courier collects */
                cod: {
                    amount: string;
                    currency: string;
                };
            }[];
            counts: {
                all: number;
                unpaid: number;
                paid: number;
                cod_due: number;
                refunds: number;
                disputes: number;
            };
            /** @description The view's sums, one row per currency (never mixed) */
            totals: {
                currency: string;
                total: {
                    amount: string;
                    currency: string;
                };
                paid: {
                    amount: string;
                    currency: string;
                };
                refunded: {
                    amount: string;
                    currency: string;
                };
                balance: {
                    amount: string;
                    currency: string;
                };
                cod: {
                    amount: string;
                    currency: string;
                };
            }[];
            nextCursor: string | null;
        };
        PlatformAnnouncement: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            level: "info" | "warning" | "critical";
            titleAr: string;
            titleEn: string;
            bodyAr: string;
            bodyEn: string;
            link: string | null;
            plans: string[] | null;
            countries: string[] | null;
            /** Format: date-time */
            startsAt: string;
            /** Format: date-time */
            endsAt: string;
            /** Format: date-time */
            createdAt: string;
        };
        PlatformAnnouncements: {
            data: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                level: "info" | "warning" | "critical";
                titleAr: string;
                titleEn: string;
                bodyAr: string;
                bodyEn: string;
                link: string | null;
                plans: string[] | null;
                countries: string[] | null;
                /** Format: date-time */
                startsAt: string;
                /** Format: date-time */
                endsAt: string;
                /** Format: date-time */
                createdAt: string;
            }[];
        };
        PlatformDeadLetters: {
            /** @description Newest first; payloads stay with the store */
            data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                storeId: string;
                storeName: string;
                kind: string;
                provider: string;
                attempts: number;
                error: string | null;
                /** Format: date-time */
                failedAt: string;
            }[];
        };
        PlatformFlag: {
            key: string;
            description: string;
            /** @description For every store without its own setting */
            enabled: boolean;
            /** @description Stores with their own setting */
            stores: {
                /** Format: uuid */
                storeId: string;
                storeName: string;
                enabled: boolean;
            }[];
            /** Format: date-time */
            updatedAt: string;
        };
        PlatformFlags: {
            data: {
                key: string;
                description: string;
                /** @description For every store without its own setting */
                enabled: boolean;
                /** @description Stores with their own setting */
                stores: {
                    /** Format: uuid */
                    storeId: string;
                    storeName: string;
                    enabled: boolean;
                }[];
                /** Format: date-time */
                updatedAt: string;
            }[];
        };
        PlatformReplayed: {
            /** @enum {boolean} */
            replayed: true;
            /** Format: uuid */
            storeId: string;
        };
        PlatformStore: {
            /** Format: uuid */
            id: string;
            name: string;
            slug: string;
            country: string;
            /** @enum {string} */
            plan: "free" | "growth" | "scale" | "enterprise";
            /** @enum {string} */
            status: "trial" | "active" | "suspended" | "deleted";
            /** Format: date-time */
            createdAt: string;
            /** @description Active members */
            members: number;
            connections: {
                total: number;
                needsAttention: number;
            };
            /** @description The last closed month's usage; the open month needs the store's own data */
            lastMonth: {
                /**
                 * Format: date
                 * @description First day of a closed month
                 */
                month: string;
                orders: number;
                whatsappMessages: number;
                aiOffers: number;
                plan: string;
            } | null;
            currency: string;
            timezone: string;
            /** Format: date-time */
            updatedAt: string;
            team: {
                /** Format: uuid */
                userId: string;
                email: string | null;
                name: string | null;
                role: string;
                status: string;
                /** Format: date-time */
                joinedAt: string;
            }[];
            integrations: {
                /** Format: uuid */
                id: string;
                kind: string;
                provider: string;
                account: string | null;
                name: string | null;
                status: string;
                reason: string | null;
                /** Format: date-time */
                updatedAt: string;
            }[];
            outbox: {
                pending: number;
                running: number;
                dead: number;
                /** Format: date-time */
                oldestPendingAt: string | null;
            };
            /** @description The latest 20; payloads stay with the store (replay from A-4 or the store's own screen) */
            deadLetters: {
                id: string;
                kind: string;
                provider: string;
                attempts: number;
                error: string | null;
                /** Format: date-time */
                failedAt: string;
            }[];
            /** @description Closed months, newest first (up to 12) */
            usage: {
                /**
                 * Format: date
                 * @description First day of a closed month
                 */
                month: string;
                orders: number;
                whatsappMessages: number;
                aiOffers: number;
                plan: string;
            }[];
            /** @description Internal; the store never sees them */
            notes: {
                /** Format: uuid */
                id: string;
                body: string;
                by: string | null;
                /** Format: date-time */
                at: string;
            }[];
        };
        PlatformStores: {
            data: {
                /** Format: uuid */
                id: string;
                name: string;
                slug: string;
                country: string;
                /** @enum {string} */
                plan: "free" | "growth" | "scale" | "enterprise";
                /** @enum {string} */
                status: "trial" | "active" | "suspended" | "deleted";
                /** Format: date-time */
                createdAt: string;
                /** @description Active members */
                members: number;
                connections: {
                    total: number;
                    needsAttention: number;
                };
                /** @description The last closed month's usage; the open month needs the store's own data */
                lastMonth: {
                    /**
                     * Format: date
                     * @description First day of a closed month
                     */
                    month: string;
                    orders: number;
                    whatsappMessages: number;
                    aiOffers: number;
                    plan: string;
                } | null;
            }[];
            total: number;
            nextOffset: number | null;
        };
        PlatformUser: {
            /** Format: uuid */
            id: string;
            email: string | null;
            phone: string | null;
            name: string | null;
            /** Format: date-time */
            createdAt: string;
            disabled: {
                /** Format: date-time */
                at: string;
                reason: string;
            } | null;
            /** @description Stores they belong to */
            stores: number;
            /** @enum {string|null} */
            staffRole: "super_admin" | "support" | "finance" | "engineer" | null;
            memberships: {
                /** Format: uuid */
                storeId: string;
                storeName: string;
                storeStatus: string;
                role: string;
                status: string;
                /** Format: date-time */
                joinedAt: string;
            }[];
        };
        PlatformUsers: {
            data: {
                /** Format: uuid */
                id: string;
                email: string | null;
                phone: string | null;
                name: string | null;
                /** Format: date-time */
                createdAt: string;
                disabled: {
                    /** Format: date-time */
                    at: string;
                    reason: string;
                } | null;
                /** @description Stores they belong to */
                stores: number;
                /** @enum {string|null} */
                staffRole: "super_admin" | "support" | "finance" | "engineer" | null;
            }[];
            total: number;
            nextOffset: number | null;
        };
        /** @description The customer's data compiled for a data request (JSON) */
        PrivacyExport: unknown;
        PrivacyRequests: {
            data: {
                /** Format: uuid */
                id: string;
                source: string;
                status: string;
                /** Format: date-time */
                dueAt: string;
                /** Format: date-time */
                completedAt: string | null;
                /** Format: date-time */
                createdAt: string;
                hasExport: boolean;
            }[];
        };
        ProblemDetails: {
            type: string;
            title: string;
            status: number;
            code: string;
            detail?: string;
            errors?: {
                path: string;
                code: string;
                message?: string;
            }[];
            requestId?: string;
        };
        ProductPage: {
            data: {
                /** Format: uuid */
                id: string;
                title: string;
                /** @enum {string} */
                status: "active" | "draft" | "archived";
                /** @description The store it syncs from; null = added in Mizan */
                store: {
                    /** Format: uuid */
                    connectionId: string;
                    provider: string;
                    name: string;
                } | null;
                variants: {
                    /** Format: uuid */
                    id: string;
                    title: string | null;
                    sku: string;
                    barcode: string | null;
                    /**
                     * @description store: follows the store's barcode on every sync; mizan: set here, syncs leave it alone
                     * @enum {string}
                     */
                    barcodeOwner: "store" | "mizan";
                    price: {
                        amount: string;
                        currency: string;
                    };
                    compareAt: {
                        amount: string;
                        currency: string;
                    } | null;
                    /** @description null until entered; 0 is a real cost */
                    cost: {
                        amount: string;
                        currency: string;
                    } | null;
                    /** @description Stock as the store last reported it; null = not known */
                    available: number | null;
                }[];
            }[];
            nextCursor: string | null;
            counts: {
                products: number;
                variants: number;
                missingCost: number;
                missingBarcode: number;
            };
        };
        ProfitBreakdown: {
            /** @enum {string} */
            by: "day" | "product" | "store" | "courier" | "country";
            /** Format: date */
            from: string;
            /** Format: date */
            to: string;
            baseCurrency: string;
            /** @description Biggest profit first; by day, in date order. A product's share of each order is split exactly (cost by its line cost, the rest by its share of the order's value) */
            rows: {
                /** @description Day, store connection id, courier connection id, country code, variant id (or title:… for a one-off item), or a special key */
                key: string;
                label: string;
                /** @description The key is one the screen names itself: manual (no store), none (no courier yet), unknown (no country), no_products */
                special: boolean;
                orders: number;
                delivered: number;
                /** @description Refused or returned after shipping */
                returned: number;
                /** @description After refunds; counted when the money is real */
                revenue: {
                    amount: string;
                    currency: string;
                };
                productCost: {
                    amount: string;
                    currency: string;
                };
                shippingAndCod: {
                    amount: string;
                    currency: string;
                };
                ads: {
                    amount: string;
                    currency: string;
                };
                /** @description Return shipping */
                returns: {
                    amount: string;
                    currency: string;
                };
                team: {
                    amount: string;
                    currency: string;
                };
                /** @description Payment, channel, packaging, chargebacks */
                fees: {
                    amount: string;
                    currency: string;
                };
                /** @description Realised profit */
                net: {
                    amount: string;
                    currency: string;
                };
                /** @description If orders on their way deliver */
                expectedNet: {
                    amount: string;
                    currency: string;
                };
                /** @description Net ÷ revenue, percent with one decimal */
                margin: string | null;
            }[];
            total: {
                /** @description Day, store connection id, courier connection id, country code, variant id (or title:… for a one-off item), or a special key */
                key: string;
                label: string;
                /** @description The key is one the screen names itself: manual (no store), none (no courier yet), unknown (no country), no_products */
                special: boolean;
                orders: number;
                delivered: number;
                /** @description Refused or returned after shipping */
                returned: number;
                /** @description After refunds; counted when the money is real */
                revenue: {
                    amount: string;
                    currency: string;
                };
                productCost: {
                    amount: string;
                    currency: string;
                };
                shippingAndCod: {
                    amount: string;
                    currency: string;
                };
                ads: {
                    amount: string;
                    currency: string;
                };
                /** @description Return shipping */
                returns: {
                    amount: string;
                    currency: string;
                };
                team: {
                    amount: string;
                    currency: string;
                };
                /** @description Payment, channel, packaging, chargebacks */
                fees: {
                    amount: string;
                    currency: string;
                };
                /** @description Realised profit */
                net: {
                    amount: string;
                    currency: string;
                };
                /** @description If orders on their way deliver */
                expectedNet: {
                    amount: string;
                    currency: string;
                };
                /** @description Net ÷ revenue, percent with one decimal */
                margin: string | null;
            };
        };
        ProfitHome: {
            baseCurrency: string;
            /** Format: date */
            today: string;
            /** Format: date */
            from: string;
            /** Format: date */
            to: string;
            days: number;
            yesterday: {
                /** Format: date */
                day: string;
                orders: number;
                revenue: {
                    amount: string;
                    currency: string;
                };
                net: {
                    amount: string;
                    currency: string;
                };
                expectedNet: {
                    amount: string;
                    currency: string;
                };
            };
            period: {
                orders: number;
                /** @description Money that is real: prepaid when paid, COD when delivered; less refunds */
                revenue: {
                    amount: string;
                    currency: string;
                };
                /** @description Σ orders' realised profit */
                net: {
                    amount: string;
                    currency: string;
                };
                /** @description Σ orders' profit if those still on their way deliver */
                expectedNet: {
                    amount: string;
                    currency: string;
                };
                /** @description Monthly fixed costs spread over the period's days */
                fixedCosts: {
                    amount: string;
                    currency: string;
                };
                /** @description Ad spend on days with no order to carry it */
                unallocatedAds: {
                    amount: string;
                    currency: string;
                };
                /** @description What the store kept: net − fixed costs − unallocated ads */
                kept: {
                    amount: string;
                    currency: string;
                };
                expectedKept: {
                    amount: string;
                    currency: string;
                };
                /** @description kept ÷ revenue */
                margin: string | null;
                /** @description Of every 100 of revenue, what was kept */
                keptPer100: {
                    amount: string;
                    currency: string;
                } | null;
                /** @description The same for the period before */
                previousKept: {
                    amount: string;
                    currency: string;
                };
                /** @description kept vs the period before */
                change: string | null;
                delivered: number;
                /** @description Refused or returned after shipping */
                returned: number;
                /** @description delivered ÷ (delivered + returned) */
                deliveryRate: string | null;
                /** @description What refused orders lost, all costs counted */
                refusalLoss: {
                    amount: string;
                    currency: string;
                };
                adSpend: {
                    amount: string;
                    currency: string;
                };
                /** @description Where every pound of revenue went */
                breakdown: {
                    revenue: {
                        amount: string;
                        currency: string;
                    };
                    productCost: {
                        amount: string;
                        currency: string;
                    };
                    shippingAndCod: {
                        amount: string;
                        currency: string;
                    };
                    ads: {
                        amount: string;
                        currency: string;
                    };
                    returns: {
                        amount: string;
                        currency: string;
                    };
                    team: {
                        amount: string;
                        currency: string;
                    };
                    /** @description Payment, channel and chargeback fees and packaging */
                    fees: {
                        amount: string;
                        currency: string;
                    };
                    fixed: {
                        amount: string;
                        currency: string;
                    };
                    kept: {
                        amount: string;
                        currency: string;
                    };
                };
            };
            cash: {
                /** @description Cash to collect on parcels on their way */
                inTransit: {
                    amount: string;
                    currency: string;
                };
                inTransitOrders: number;
                /** @description Cash collected by couriers, not yet paid to the store */
                awaitingRemittance: {
                    amount: string;
                    currency: string;
                };
                awaitingRemittanceOrders: number;
            };
            trend: {
                /** Format: date */
                day: string;
                orders: number;
                net: {
                    amount: string;
                    currency: string;
                };
                expectedNet: {
                    amount: string;
                    currency: string;
                };
            }[];
            /** @description What is costing money or hiding it, most costly first */
            leaks: {
                /** @enum {string} */
                kind: "losing_orders" | "refusals" | "unallocated_ads" | "other_currency" | "cost_missing" | "shipping_rate_missing" | "cod_fee_missing" | "agent_cost_missing" | "packaging_cost_missing" | "payment_fee_missing" | "fx_missing" | "ads_fx_missing" | "sync_gap";
                count: number;
                amount: {
                    amount: string;
                    currency: string;
                } | null;
            }[];
        };
        PublicAnswer: {
            /** @enum {string} */
            answer: "confirm" | "cancel" | "change";
            /**
             * @description Why they cancel
             * @enum {string}
             */
            reason?: "changed_mind" | "ordered_by_mistake" | "found_cheaper" | "delivery_too_late" | "other";
            /** @description What to change (stored encrypted) */
            note?: string;
            /** @description Shared from the phone, for the courier */
            location?: {
                lat: number;
                lng: number;
            };
        };
        PublicConfirmation: {
            store: string;
            /** @enum {string} */
            state: "open" | "confirmed" | "cancelled" | "changed" | "expired" | "closed";
            firstName: string | null;
            order: {
                number: string;
                items: {
                    title: string;
                    quantity: number;
                }[];
                total: {
                    amount: string;
                    currency: string;
                };
                /** @description What the customer pays the courier */
                cod: {
                    amount: string;
                    currency: string;
                };
                city: string | null;
            };
            hasLocation: boolean;
            /** Format: date-time */
            expiresAt: string;
        };
        PutFlag: {
            enabled: boolean;
            description?: string;
        };
        PutStoreFlag: {
            enabled: boolean;
        };
        PutStoreSync: {
            /** @description Courier steps as Shopify fulfillment events: picked up, in transit, out for delivery, attempts, delivered, failures */
            progressEvents?: boolean;
            /** @description Mark cash-on-delivery orders paid in Shopify when delivered */
            markPaidOnDelivery?: boolean;
            /** @description Tag mizan-returned when the parcel is back */
            tagReturned?: boolean;
            /** @description Tag mizan-lost when the courier lost it */
            tagLost?: boolean;
        };
        ReactivateStore: {
            reason?: string;
        };
        Ready: {
            /** @enum {string} */
            status: "ready";
        };
        Recalculate: {
            /**
             * Format: date
             * @description First order day (store time)
             */
            from?: string;
            /**
             * Format: date
             * @description Last order day (store time)
             */
            to?: string;
        };
        Recalculated: {
            recomputed: number;
            /** @description More provisional orders remain: call again */
            truncated: boolean;
        };
        RecipeList: {
            data: {
                key: string;
                /** @enum {string} */
                domain: "orders" | "verification" | "fulfilment" | "platform";
                name: string;
                trigger: string;
                conditions: unknown;
                steps: {
                    action: string;
                    params: {
                        [key: string]: unknown;
                    };
                }[];
                /**
                 * Format: uuid
                 * @description The store's copy, if installed
                 */
                installed: string | null;
            }[];
        };
        RecordMovements: {
            items: {
                /** Format: uuid */
                variantId: string;
                /**
                 * @description receive: add arrived stock; count: set on hand to what was counted; adjust: add or remove with a reason
                 * @enum {string}
                 */
                kind: "receive" | "count" | "adjust";
                /** @description receive: > 0; count: ≥ 0 (the number on the shelf); adjust: ≠ 0 */
                quantity: number;
                /**
                 * @description Required for adjust
                 * @enum {string}
                 */
                reason?: "damaged" | "lost" | "found" | "correction" | "other";
            }[];
            note?: string;
        };
        RecordPayment: {
            /**
             * @description Money the customer paid, or money given back to them
             * @enum {string}
             */
            type: "received" | "refunded";
            /** @enum {string} */
            method: "bank_transfer" | "instapay" | "wallet" | "cash_pos" | "store_credit";
            /** @description In the order's currency, e.g. "250.00"; Arabic digits accepted */
            amount: string;
            /** @description A transfer reference or why; no card numbers */
            note?: string;
            /**
             * Format: date-time
             * @description When the money moved; now if absent
             */
            occurredAt?: string;
        };
        Refund: {
            /** Format: uuid */
            id: string;
            /** @description R-1001 */
            number: string;
            order: {
                /** Format: uuid */
                id: string;
                number: string;
            };
            ticket: {
                /** Format: uuid */
                id: string;
                number: string;
            } | null;
            amount: {
                amount: string;
                currency: string;
            };
            /** @enum {string} */
            destination: "original_method" | "store_credit" | "bank_transfer" | "cash";
            /** @enum {string} */
            status: "requested" | "approved" | "completed" | "rejected" | "failed";
            reason: string | null;
            requestedBy: {
                /** Format: uuid */
                id: string;
                name: string | null;
            } | null;
            approvedBy: {
                /** Format: uuid */
                id: string;
                name: string | null;
            } | null;
            rejectionReason: string | null;
            reference: string | null;
            /** @description Over the store's threshold (or in another currency) */
            needsApproval: boolean;
            /** @description What the caller may do with it now */
            can: {
                approve: boolean;
                reject: boolean;
                complete: boolean;
            };
            /** @description Back to the original method on a store order: do it in the store; it completes when the store reports it */
            completesFromStore: boolean;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            approvedAt: string | null;
            /** Format: date-time */
            completedAt: string | null;
        };
        RefundList: {
            data: {
                /** Format: uuid */
                id: string;
                /** @description R-1001 */
                number: string;
                order: {
                    /** Format: uuid */
                    id: string;
                    number: string;
                };
                ticket: {
                    /** Format: uuid */
                    id: string;
                    number: string;
                } | null;
                amount: {
                    amount: string;
                    currency: string;
                };
                /** @enum {string} */
                destination: "original_method" | "store_credit" | "bank_transfer" | "cash";
                /** @enum {string} */
                status: "requested" | "approved" | "completed" | "rejected" | "failed";
                reason: string | null;
                requestedBy: {
                    /** Format: uuid */
                    id: string;
                    name: string | null;
                } | null;
                approvedBy: {
                    /** Format: uuid */
                    id: string;
                    name: string | null;
                } | null;
                rejectionReason: string | null;
                reference: string | null;
                /** @description Over the store's threshold (or in another currency) */
                needsApproval: boolean;
                /** @description What the caller may do with it now */
                can: {
                    approve: boolean;
                    reject: boolean;
                    complete: boolean;
                };
                /** @description Back to the original method on a store order: do it in the store; it completes when the store reports it */
                completesFromStore: boolean;
                /** Format: date-time */
                createdAt: string;
                /** Format: date-time */
                approvedAt: string | null;
                /** Format: date-time */
                completedAt: string | null;
            }[];
            counts: {
                requested: number;
                approved: number;
                completed: number;
                rejected: number;
            };
        };
        RefundOptions: {
            /** @description What the order holds less refunds still open */
            refundable: {
                amount: string;
                currency: string;
            };
            destinations: ("original_method" | "store_credit" | "bank_transfer" | "cash")[];
            /** @description The store's threshold; above it a refund needs approval */
            approveOver: {
                amount: string;
                currency: string;
            };
        };
        RefundSettings: {
            /** @description Refunds above this amount, in the store's base currency, need owner, admin or finance to approve; 0 means every refund does */
            approveOver: string;
        };
        RefundSettingsView: {
            /** @description Decimal in the store's base currency, e.g. "1000.00" */
            approveOver: string;
        };
        Refusal: {
            /** @enum {string} */
            reason: "changed_mind" | "wrong_item" | "wrong_size" | "damaged" | "not_as_described" | "quality" | "price" | "late_delivery" | "courier_behaviour" | "other";
            /** @description The customer opened the parcel to inspect it before refusing (المعاينة) */
            openBox: boolean;
            note?: string;
        };
        RefusalRecorded: {
            /** Format: uuid */
            orderId: string;
            /** @enum {string} */
            reason: "changed_mind" | "wrong_item" | "wrong_size" | "damaged" | "not_as_described" | "quality" | "price" | "late_delivery" | "courier_behaviour" | "other";
            openBox: boolean;
            /** Format: date-time */
            at: string;
        };
        RejectRefund: {
            reason: string;
        };
        Replayed: {
            /** @enum {boolean} */
            replayed: true;
        };
        ResolveCity: {
            text: string;
            cityId: string;
            jobId?: string;
        };
        ResolveDuplicate: {
            /**
             * @description keep: both are real orders; merge: cancel this one as a duplicate of the earlier
             * @enum {string}
             */
            action: "keep" | "merge";
        };
        ReturnState: {
            /** Format: uuid */
            orderId: string;
            /** @description Returned, or delivered and sent back by the customer */
            eligible: boolean;
            /** @description Whether the caller may record an inspection */
            canInspect: boolean;
            lines: {
                /** Format: uuid */
                lineId: string;
                title: string;
                sku: string | null;
                /** Format: uuid */
                variantId: string | null;
                quantity: number;
                restock: number;
                damaged: number;
                writeOff: number;
                /** @description Units not inspected yet */
                remaining: number;
            }[];
            /** @description Newest first */
            inspections: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                lineId: string;
                title: string;
                quantity: number;
                /** @enum {string} */
                outcome: "restock" | "damaged" | "write_off";
                note: string | null;
                by: string | null;
                /** Format: date-time */
                at: string;
            }[];
        };
        RevealedCustomer: {
            name: string | null;
            /** @description E.164 */
            phone: string | null;
            address: {
                line1: string | null;
                line2: string | null;
                city: string | null;
                province: string | null;
                country: string | null;
            };
            location: {
                lat: number;
                lng: number;
            } | null;
        };
        ScriptPreview: {
            /** @enum {string} */
            lang: "ar" | "en";
            sample: boolean;
            /** @description What the customer reads after each button */
            replies: {
                /** @enum {string} */
                branch: "confirm" | "change" | "cancel";
                /** @enum {string} */
                key: "confirmed" | "change_prompt" | "change_received" | "cancel_prompt" | "cancelled" | "call";
                text: string;
            }[];
            /** @description The team's call script, line by line */
            call: string[];
        };
        ScriptPreviewRequest: {
            script: {
                /**
                 * @description The starting wording: egyptian (default) or formal Arabic
                 * @enum {string}
                 */
                pack: "egyptian" | "formal";
                /** @description The owner's own wording per message and language; empty = the pack's */
                texts: {
                    ar: {
                        confirmed?: string;
                        change_prompt?: string;
                        change_received?: string;
                        cancel_prompt?: string;
                        cancelled?: string;
                        call?: string;
                    };
                    en: {
                        confirmed?: string;
                        change_prompt?: string;
                        change_received?: string;
                        cancel_prompt?: string;
                        cancelled?: string;
                        call?: string;
                    };
                };
            };
            /**
             * Format: uuid
             * @description One of the store's orders; a sample order when absent
             */
            orderId?: string;
        };
        SetAdSpend: {
            /**
             * Format: date
             * @description YYYY-MM-DD in the store's time zone
             */
            day: string;
            /** @enum {string} */
            platform: "meta" | "tiktok" | "google" | "snapchat" | "other";
            /** @description What the platform charged that day */
            amount: string;
            /** @description Default: the store's base currency */
            currency?: string;
            /**
             * Format: uuid
             * @description The store the ads sold for (default: the only store)
             */
            connectionId?: string;
        };
        SetCosts: {
            items: {
                /** Format: uuid */
                variantId: string;
                cost: string;
            }[];
        };
        SetFxRate: {
            /** @description 1 unit of the store's base currency = rate units of the quote currency */
            rate: string;
        };
        SetShipmentStatus: {
            /** @enum {string} */
            status: "created" | "pickup_requested" | "picked_up" | "in_transit" | "out_for_delivery" | "delivered" | "failed_attempt" | "returning" | "returned" | "cancelled" | "lost";
            /** @description Why (what the courier said on the phone, the label seen) */
            note?: string;
        };
        Shipment: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            orderId: string;
            provider: string;
            /**
             * @description pending: the courier is being booked; booked: it has a tracking number; failed: see error
             * @enum {string}
             */
            booking: "pending" | "booked" | "failed";
            /** @description The courier's status, canonical (created, pickup_requested … delivered, returned) */
            status: string;
            trackingNumber: string | null;
            trackingUrl: string | null;
            /** @description Cash the courier collects (cashToCollect: 0 when prepaid, the balance for a deposit) */
            cod: {
                amount: string;
                currency: string;
            };
            error: {
                /** @enum {string} */
                code: "city_unknown" | "address_invalid" | "payment_blocks" | "cancelled" | "not_found" | "courier_refused_key" | "courier_failed";
                message: string;
            } | null;
            /** Format: date-time */
            requestedAt: string;
            /** Format: date-time */
            bookedAt: string | null;
        };
        ShipmentHistory: {
            data: {
                status: string;
                statusRaw: string | null;
                /** @enum {string} */
                source: "webhook" | "poll" | "ops";
                /** Format: date-time */
                at: string;
                note: string | null;
            }[];
        };
        ShipmentPage: {
            data: {
                /** Format: uuid */
                id: string;
                order: {
                    /** Format: uuid */
                    id: string;
                    number: string;
                    status: string;
                };
                provider: string;
                /** @enum {string} */
                booking: "pending" | "booked" | "failed";
                status: string;
                /** @description What the courier sent, verbatim */
                statusRaw: string | null;
                /** Format: date-time */
                statusAt: string | null;
                needsReview: boolean;
                errorCode: string | null;
                trackingNumber: string | null;
                trackingUrl: string | null;
                cod: {
                    amount: string;
                    currency: string;
                };
                area: {
                    city: string | null;
                    province: string | null;
                };
                /** Format: date-time */
                createdAt: string;
            }[];
            counts: {
                active: number;
                review: number;
                delivered: number;
                returned: number;
                all: number;
            };
            nextCursor: string | null;
        };
        ShipmentStatusesImported: {
            rows: number;
            changed: number;
            /** @description Already at that status */
            unchanged: number;
            review: number;
        };
        ShipmentStatusSet: {
            /** Format: uuid */
            id: string;
            status: string;
        };
        ShopifyClaim: {
            install: string;
        };
        ShopifyClaimResult: {
            connection: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                provider: "shopify";
                account: string;
                /** @enum {string} */
                status: "active";
                scopes: string[];
            };
            reconnected: boolean;
        };
        ShopifyInstallStart: {
            /**
             * Format: uri
             * @description Send the browser here (Shopify's consent screen)
             */
            authorizeUrl: string;
        };
        Staff: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            userId: string;
            email: string | null;
            name: string | null;
            /** @enum {string} */
            role: "super_admin" | "support" | "finance" | "engineer";
            /** @enum {string} */
            status: "active" | "disabled";
            /** Format: date-time */
            createdAt: string;
        };
        StaffList: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                userId: string;
                email: string | null;
                name: string | null;
                /** @enum {string} */
                role: "super_admin" | "support" | "finance" | "engineer";
                /** @enum {string} */
                status: "active" | "disabled";
                /** Format: date-time */
                createdAt: string;
            }[];
        };
        StaffMe: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            role: "super_admin" | "support" | "finance" | "engineer";
            email: string | null;
        };
        StaffTrail: {
            data: {
                id: number;
                /** Format: uuid */
                staffId: string | null;
                /** @description Who called: staff, or a non-staff user who was refused */
                email: string | null;
                /** @description The route called, or what was done */
                action: string;
                /** @enum {string} */
                outcome: "ok" | "denied" | "failed";
                status: number | null;
                target: {
                    type: string;
                    id: string | null;
                } | null;
                /** Format: uuid */
                storeId: string | null;
                /** Format: date-time */
                at: string;
            }[];
            nextBefore: number | null;
        };
        StockHistory: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                at: string;
                /** @enum {string} */
                kind: "receive" | "count" | "adjust" | "reserve" | "release" | "pick" | "return_restock" | "transfer_in" | "transfer_out" | "write_off";
                /** @description Change to on hand (receive, count, adjust, pick) or to reserved (reserve, release) */
                delta: number;
                reason: string | null;
                note: string | null;
                order: {
                    /** Format: uuid */
                    id: string;
                    number: string;
                } | null;
            }[];
        };
        StockPage: {
            data: {
                /** Format: uuid */
                variantId: string;
                productTitle: string;
                variantTitle: string | null;
                sku: string;
                barcode: string | null;
                /** @description true once received or counted in Mizan; then confirmed orders reserve it */
                counted: boolean;
                onHand: number | null;
                reserved: number | null;
                /** @description On hand − reserved; null when not counted */
                available: number | null;
                /** @description What the store last reported (information only once counted here) */
                storeAvailable: number | null;
                lowStockAt: number | null;
            }[];
            nextCursor: string | null;
            warehouse: {
                /** Format: uuid */
                id: string;
                name: string;
            };
            counts: {
                variants: number;
                counted: number;
                out: number;
                low: number;
                /** @description Confirmed orders waiting for stock (oversell blocked) */
                waitingOrders: number;
            };
        };
        StockThreshold: {
            /** @description Alert (stock.low) when available falls to this or under; null: no alert */
            lowStockAt: number | null;
        };
        StockThresholdSet: {
            /** Format: uuid */
            variantId: string;
            lowStockAt: number | null;
            available: number;
        };
        StoreAnnouncements: {
            /** @description Most serious first; both languages, the dashboard shows its own */
            data: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                level: "info" | "warning" | "critical";
                titleAr: string;
                titleEn: string;
                bodyAr: string;
                bodyEn: string;
                link: string | null;
                /** Format: date-time */
                endsAt: string;
            }[];
        };
        StoreFlags: {
            /** @description Every flag, as it applies to this store */
            flags: {
                [key: string]: boolean;
            };
        };
        StoreNote: {
            /** Format: uuid */
            id: string;
            body: string;
            by: string | null;
            /** Format: date-time */
            at: string;
        };
        StoreState: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            plan: "free" | "growth" | "scale" | "enterprise";
            /** @enum {string} */
            status: "trial" | "active" | "suspended" | "deleted";
            /** Format: date-time */
            updatedAt: string;
        };
        StoreSupportAccess: {
            data: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                mode: "read" | "write";
                reason: string;
                /** Format: date-time */
                startedAt: string;
                /** Format: date-time */
                expiresAt: string;
            }[];
        };
        StoreSync: {
            /** @description Courier steps as Shopify fulfillment events: picked up, in transit, out for delivery, attempts, delivered, failures */
            progressEvents: boolean;
            /** @description Mark cash-on-delivery orders paid in Shopify when delivered */
            markPaidOnDelivery: boolean;
            /** @description Tag mizan-returned when the parcel is back */
            tagReturned: boolean;
            /** @description Tag mizan-lost when the courier lost it */
            tagLost: boolean;
        };
        SupportAccessEnded: {
            /** @description Grants ended */
            ended: number;
        };
        SupportGrant: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            storeId: string;
            storeName: string;
            /** @enum {string} */
            mode: "read" | "write";
            reason: string;
            /** Format: date-time */
            startedAt: string;
            /** Format: date-time */
            expiresAt: string;
        };
        SupportGrants: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                storeId: string;
                storeName: string;
                /** @enum {string} */
                mode: "read" | "write";
                reason: string;
                /** Format: date-time */
                startedAt: string;
                /** Format: date-time */
                expiresAt: string;
            }[];
        };
        SuspendStore: {
            /** @description Shown to the store in its audit log */
            reason: string;
        };
        SystemHealth: {
            /** Format: date-time */
            at: string;
            /** @description mizan_outbox_jobs, every store */
            outbox: {
                pending: number;
                running: number;
                dead: number;
                /** @description mizan_outbox_oldest_due_seconds */
                oldestDueSeconds: number;
            };
            /** @description mizan_domain_events */
            events: {
                pending: number;
                dead: number;
                oldestPendingSeconds: number;
            };
            /** @description Dead domain events by type, most first */
            deadEvents: {
                type: string;
                count: number;
            }[];
            /** @description mizan_engine_circuits_open: store engines built on this API instance */
            circuits: {
                /** @enum {string} */
                provider: "shopify" | "woocommerce" | "bosta";
                open: number;
                halfOpen: number;
                closed: number;
            }[];
            /** @description Stores with the most jobs waiting or dead (up to 20) */
            stores: {
                /** Format: uuid */
                storeId: string;
                storeName: string;
                pending: number;
                running: number;
                dead: number;
                oldestDueSeconds: number;
            }[];
            /** @description Provider fields and statuses that changed shape, across this instance's engines, most frequent first (no samples) */
            drift: {
                connector: string;
                entity: string;
                kind: string;
                field: string | null;
                detail: string;
                count: number;
                stores: number;
                /** Format: date-time */
                lastAt: string;
            }[];
            db: {
                /** @description mizan_db_pool_connections */
                pool: {
                    total: number;
                    idle: number;
                    waiting: number;
                } | null;
                sizeBytes: number | null;
                connections: number | null;
            };
            process: {
                uptimeSeconds: number;
                rssBytes: number;
                heapUsedBytes: number;
            };
        };
        Team: {
            members: {
                /** Format: uuid */
                userId: string;
                displayName: string | null;
                email: string | null;
                /** @description E.164 */
                phone: string | null;
                /** @enum {string} */
                role: "owner" | "admin" | "ops_manager" | "agent" | "warehouse" | "finance" | "media_buyer";
                /** @enum {string} */
                status: "active" | "invited" | "disabled";
                /** Format: date-time */
                joinedAt: string;
            }[];
            invitations: {
                /** Format: uuid */
                id: string;
                email: string | null;
                phone: string | null;
                /** @enum {string} */
                role: "owner" | "admin" | "ops_manager" | "agent" | "warehouse" | "finance" | "media_buyer";
                /** @enum {string} */
                status: "pending" | "accepted" | "revoked";
                /** Format: date-time */
                expiresAt: string;
                /** Format: date-time */
                createdAt: string;
                /**
                 * Format: uri
                 * @description Link to share; opening it still requires signing in with the invited email or phone
                 */
                acceptUrl: string;
            }[];
        };
        Tenant: {
            /** Format: uuid */
            id: string;
            name: string;
            slug: string;
            /** @description ISO 3166-1 alpha-2 */
            country: string;
            /** @description ISO 4217 */
            baseCurrency: string;
            timezone: string;
            locale: string;
            /** @enum {string} */
            plan: "free" | "growth" | "scale" | "enterprise";
            /** @enum {string} */
            status: "trial" | "active" | "suspended" | "deleted";
            settings: {
                [key: string]: unknown;
            };
            /** Format: date-time */
            createdAt: string;
            /**
             * @description The caller's role in this store
             * @enum {string}
             */
            role: "owner" | "admin" | "ops_manager" | "agent" | "warehouse" | "finance" | "media_buyer";
        };
        Ticket: {
            /** Format: uuid */
            id: string;
            /** @description T-1001 */
            number: string;
            /** @enum {string} */
            type: "complaint" | "exchange" | "refund" | "delivery_issue" | "return" | "refused";
            /** @enum {string|null} */
            reason: "wrong_size" | "wrong_item" | "damaged" | "missing_item" | "not_as_described" | "quality" | "changed_mind" | "late_delivery" | "courier_behaviour" | "not_delivered" | "price" | "other" | null;
            /** @enum {string} */
            status: "open" | "waiting_customer" | "waiting_courier" | "in_inspection" | "resolved" | "closed";
            /** @enum {string} */
            source: "team" | "whatsapp" | "phone" | "courier" | "automation";
            order: {
                /** Format: uuid */
                id: string;
                number: string;
                status: string;
            } | null;
            assignee: {
                /** Format: uuid */
                id: string;
                name: string | null;
            } | null;
            /** Format: date-time */
            dueAt: string | null;
            /** @description Still open past its deadline */
            late: boolean;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            description: string | null;
            createdBy: {
                /** Format: uuid */
                id: string;
                name: string | null;
            } | null;
            /** Format: date-time */
            resolvedAt: string | null;
            /** Format: date-time */
            closedAt: string | null;
            /** @description Whether the caller may change status, type, reason and assignee (anyone who sees it may add a note) */
            canEdit: boolean;
            /** @description Who the caller may assign it to */
            assignees: {
                /** Format: uuid */
                id: string;
                name: string | null;
                role: string;
            }[];
            history: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                type: "created" | "status" | "assigned" | "updated" | "note" | "refund";
                /** Format: date-time */
                at: string;
                actor: {
                    /** Format: uuid */
                    id: string;
                    name: string | null;
                } | null;
                /** @description status: from, to; assigned: to; updated: changed fields */
                data: {
                    [key: string]: unknown;
                };
                note: string | null;
            }[];
        };
        TicketPage: {
            data: {
                /** Format: uuid */
                id: string;
                /** @description T-1001 */
                number: string;
                /** @enum {string} */
                type: "complaint" | "exchange" | "refund" | "delivery_issue" | "return" | "refused";
                /** @enum {string|null} */
                reason: "wrong_size" | "wrong_item" | "damaged" | "missing_item" | "not_as_described" | "quality" | "changed_mind" | "late_delivery" | "courier_behaviour" | "not_delivered" | "price" | "other" | null;
                /** @enum {string} */
                status: "open" | "waiting_customer" | "waiting_courier" | "in_inspection" | "resolved" | "closed";
                /** @enum {string} */
                source: "team" | "whatsapp" | "phone" | "courier" | "automation";
                order: {
                    /** Format: uuid */
                    id: string;
                    number: string;
                    status: string;
                } | null;
                assignee: {
                    /** Format: uuid */
                    id: string;
                    name: string | null;
                } | null;
                /** Format: date-time */
                dueAt: string | null;
                /** @description Still open past its deadline */
                late: boolean;
                /** Format: date-time */
                createdAt: string;
                /** Format: date-time */
                updatedAt: string;
            }[];
            counts: {
                active: number;
                open: number;
                waiting: number;
                inspection: number;
                resolved: number;
                closed: number;
                late: number;
            };
            nextCursor: string | null;
        };
        UpdateMember: {
            /** @enum {string} */
            role?: "owner" | "admin" | "ops_manager" | "agent" | "warehouse" | "finance" | "media_buyer";
            /** @enum {string} */
            status?: "active" | "disabled";
        };
        UpdateOnboarding: {
            skip?: {
                courier?: boolean;
                costs?: boolean;
            };
            dismissed?: boolean;
        };
        UpdateStaff: {
            /** @enum {string} */
            role?: "super_admin" | "support" | "finance" | "engineer";
            /** @enum {string} */
            status?: "active" | "disabled";
        };
        UpdateTenant: {
            name?: string;
            timezone?: string;
            /** @description Language and region for customer messages and documents */
            locale?: string;
        };
        UpdateTicket: {
            /** @enum {string} */
            status?: "open" | "waiting_customer" | "waiting_courier" | "in_inspection" | "resolved" | "closed";
            /** @enum {string} */
            type?: "complaint" | "exchange" | "refund" | "delivery_issue" | "return" | "refused";
            /** @enum {string|null} */
            reason?: "wrong_size" | "wrong_item" | "damaged" | "missing_item" | "not_as_described" | "quality" | "changed_mind" | "late_delivery" | "courier_behaviour" | "not_delivered" | "price" | "other" | null;
            /**
             * Format: uuid
             * @description null to unassign
             */
            assignedTo?: string | null;
            /** @description A note on the ticket's history */
            note?: string;
        };
        UpdateVariant: {
            /** @description In the variant's currency */
            cost?: string;
            /** @description Set here (Mizan owns it from then); null gives it back to the store's barcode */
            barcode?: string | null;
        };
        UpgradeRequest: {
            /**
             * @description A plan above the current one
             * @enum {string}
             */
            plan: "free" | "growth" | "scale" | "enterprise";
        };
        UpgradeRequested: {
            /** @enum {string} */
            plan: "free" | "growth" | "scale" | "enterprise";
            /** Format: date-time */
            at: string;
        };
        Usage: {
            /** @description YYYY-MM */
            month: string;
            timezone: string;
            /** @enum {string} */
            plan: "free" | "growth" | "scale" | "enterprise";
            /** @description The month is over and its numbers are frozen */
            closed: boolean;
            usage: {
                /** @description Orders placed in the month, every channel */
                orders: number;
                /** @description WhatsApp messages Mizan sent (failed sends not counted) */
                whatsappMessages: number;
                /** @description Offers Claude wrote */
                aiOffers: number;
                /** @description Store connections that are on */
                stores: number;
                /** @description Active team members */
                users: number;
            };
            /** @description The plan's limits; null = none */
            limits: {
                ordersPerMonth: number | null;
                stores: number | null;
                users: number | null;
            };
            /** @description Limits this month is near (80%) or past; nothing is blocked */
            alerts: {
                /** @enum {string} */
                metric: "orders" | "stores" | "users";
                /** @enum {string} */
                level: "near" | "over";
                used: number;
                limit: number;
            }[];
            /** @description The plan to upgrade to; null on the top plan */
            nextPlan: {
                /** @enum {string} */
                plan: "free" | "growth" | "scale" | "enterprise";
                limits: {
                    ordersPerMonth: number | null;
                    stores: number | null;
                    users: number | null;
                };
            } | null;
            /** @description An upgrade the store asked for and that is not done yet */
            upgradeRequest: {
                /** @enum {string} */
                plan: "free" | "growth" | "scale" | "enterprise";
                /** Format: date-time */
                at: string;
            } | null;
            /** @description This month and the five before, newest first */
            history: {
                month: string;
                orders: number;
                whatsappMessages: number;
                aiOffers: number;
                closed: boolean;
            }[];
        };
        VariantCostPage: {
            data: {
                /** Format: uuid */
                variantId: string;
                productTitle: string;
                variantTitle: string | null;
                sku: string;
                price: {
                    amount: string;
                    currency: string;
                };
                /** @description null until entered; 0 is a real cost */
                cost: {
                    amount: string;
                    currency: string;
                } | null;
            }[];
            nextCursor: string | null;
            counts: {
                variants: number;
                missingCost: number;
            };
        };
        WhatsAppConnect: {
            /** @description Phone number ID (not the phone number) */
            phoneNumberId: string;
            /** @description WhatsApp Business Account ID */
            wabaId: string;
            /** @description A permanent system-user token with whatsapp_business_messaging and whatsapp_business_management; stored encrypted, never shown again */
            accessToken: string;
        };
        WooCommerceAuthorize: {
            /** @description The store's address, https://shop.example.com */
            siteUrl: string;
            /**
             * @description Where the owner comes back to after approving
             * @default ar
             * @enum {string}
             */
            locale: "ar" | "en";
        };
        WooCommerceAuthorizeUrl: {
            /**
             * Format: uri
             * @description WooCommerce's approval page (/wc-auth/v1/authorize) for this store
             */
            url: string;
            /**
             * Format: date-time
             * @description Approve before this; then ask for a new link
             */
            expiresAt: string;
        };
        WooCommerceKeys: {
            /** @description The store's address, https://shop.example.com */
            siteUrl: string;
            /** @description ck_…; stored encrypted, never shown again */
            consumerKey: string;
            /** @description cs_…; stored encrypted, never shown again */
            consumerSecret: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    PaymentsController_get: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every money movement on the order, newest first, and its totals */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ledger"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PaymentsController_record: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecordPayment"];
            };
        };
        responses: {
            /** @description Recorded and audited; the ledger as it is now */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ledger"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PaymentsListController_list: {
        parameters: {
            query?: {
                /** @description unpaid: waiting for money before shipping; cod_due: cash the courier still has to collect; refunds; disputes */
                view?: "all" | "unpaid" | "paid" | "cod_due" | "refunds" | "disputes";
                mode?: "cod" | "prepaid" | "partial" | "bnpl" | "bank_transfer" | "unknown";
                /** @description The order's number */
                q?: string;
                limit?: number;
                cursor?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Newest first, with counts per view and the view's sums per currency */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaymentPage"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PaymentsListController_mix: {
        parameters: {
            query?: {
                days?: number;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Orders by payment mode and money in by method over the last 7, 30 or 90 days */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaymentMix"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OrderRefundsController_options: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description What can still go back on this order, where to, and the approval threshold */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefundOptions"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OrderRefundsController_request: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewRefund"];
            };
        };
        responses: {
            /** @description Numbered R-1001…; approved at once under the store's threshold (store credit then completes); audited */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Refund"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    RefundsController_list: {
        parameters: {
            query?: {
                /** @description open: requested or approved, still to do (default) */
                status?: "requested" | "approved" | "completed" | "rejected" | "failed" | "open" | "all";
                orderId?: string;
                limit?: number;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Newest first; open (default) is what still needs approving or sending */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefundList"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    RefundsController_approve: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                refundId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Approved; never by whoever asked unless the owner; store credit completes at once; audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Refund"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    RefundsController_reject: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                refundId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RejectRefund"];
            };
        };
        responses: {
            /** @description Rejected with a reason; audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Refund"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    RefundsController_complete: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                refundId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CompleteRefund"];
            };
        };
        responses: {
            /** @description The money went back (a transfer, cash, or a gateway refund on Mizan's own orders): a refund line in the ledger; audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Refund"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    RefundSettingsController_get: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Refunds above approveOver (base currency) need owner, admin or finance */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefundSettingsView"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    RefundSettingsController_put: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefundSettings"];
            };
        };
        responses: {
            /** @description Saved for refunds asked from now on; audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefundSettingsView"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OrdersController_list: {
        parameters: {
            query?: {
                status?: "new" | "pending_confirmation" | "confirmed" | "cancelled" | "shipped" | "delivered" | "returned";
                /** @description needs_call: orders the team should call now */
                confirmation?: "needs_call";
                /** @description suspected: likely duplicates waiting for the team (keep or merge) */
                duplicate?: "suspected";
                /** @description short: confirmed orders waiting for stock (oversell blocked, E8-2) */
                stock?: "short";
                /** @description ready: confirmed orders with no courier yet, not waiting for stock or a duplicate check (E7-2) */
                shipping?: "ready";
                /** @description Order number, store order id, or the customer's phone */
                q?: string;
                paymentMode?: "cod" | "prepaid" | "partial" | "bnpl" | "bank_transfer" | "store_credit" | "mixed" | "unknown";
                connectionId?: string;
                from?: string;
                to?: string;
                limit?: number;
                cursor?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Agents see orders assigned to them; warehouse sees confirmed and shipped orders */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderPage"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OrdersController_create: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewOrder"];
            };
        };
        responses: {
            /** @description Created as M-1001, M-1002…; an agent's order is assigned to them; audited */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderCreated"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OrdersController_bulkRequest: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkRequest"];
            };
        };
        responses: {
            /** @description Accepted: the worker applies it in chunks; audited */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkAction"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OrdersController_bulkProgress: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                bulkId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Progress: done, skipped and failed so far, and why each order was skipped or failed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkAction"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OrdersController_products: {
        parameters: {
            query?: {
                /** @description Product title or SKU */
                q?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Active products to add to a manual order (100 at most) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderProducts"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OrdersController_detail: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One order; an order outside the caller's scope is not found */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OrdersController_reveal: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Name, phone, address and map pin; recorded in the audit log */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevealedCustomer"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Gone (pii_redacted: deleted on request, …) */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Too many requests (rate_limited; see Retry-After) */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OrdersController_resolveDuplicate: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResolveDuplicate"];
            };
        };
        responses: {
            /** @description The order's answer; one already answered keeps it */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DuplicateResolved"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OrderSettingsController_get: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description How orders are handled as they arrive */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderSettings"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OrderSettingsController_put: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OrderSettings"];
            };
        };
        responses: {
            /** @description Saved; applies to orders that arrive from now on */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderSettings"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OnboardingController_get: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Setup steps, milestones and time-to-first-value */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Onboarding"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OnboardingController_update: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateOnboarding"];
            };
        };
        responses: {
            /** @description The setup after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Onboarding"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    CatalogController_list: {
        parameters: {
            query?: {
                missingCost?: "true" | "false";
                limit?: number;
                cursor?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Variants with their price and cost, oldest first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VariantCostPage"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    CatalogController_set: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetCosts"];
            };
        };
        responses: {
            /** @description Saved; how many variants still have no cost */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CostsUpdated"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProductsController_list: {
        parameters: {
            query?: {
                search?: string;
                /** @description all = active and draft (archived only when asked) */
                status?: "active" | "draft" | "archived" | "all";
                /** @description Only products with a variant missing its cost or barcode */
                missing?: "cost" | "barcode";
                limit?: number;
                cursor?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Products by title, each with its variants */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductPage"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProductsController_update: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateVariant"];
            };
        };
        responses: {
            /** @description Saved; title, price and SKU are the store's and change there */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogVariant"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProductsController_import: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportCosts"];
            };
        };
        responses: {
            /** @description Every row applied; any bad line: 422 csv_invalid naming each line, nothing saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CostsImported"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StockController_list: {
        parameters: {
            query?: {
                /** @description Product title, SKU or barcode (part of it) */
                search?: string;
                /** @description counted: stock kept in Mizan; out: counted with nothing available; low: at or under its threshold */
                filter?: "all" | "counted" | "not_counted" | "out" | "low";
                limit?: number;
                cursor?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Variants by SKU with on hand, reserved and available */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StockPage"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StockController_record: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecordMovements"];
            };
        };
        responses: {
            /** @description All applied, or none (422 below_reserved naming each item) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MovementsRecorded"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StockController_history: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                variantId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The last 100 movements, newest first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StockHistory"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StockController_threshold: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                variantId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StockThreshold"];
            };
        };
        responses: {
            /** @description Saved; stock.low fires when available falls to it or under */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StockThresholdSet"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    InventorySettingsController_get: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description How stock is shared with the store */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InventorySettings"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    InventorySettingsController_put: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InventorySettings"];
            };
        };
        responses: {
            /** @description Saved; turning it on sends every counted item's number to the store */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InventorySettings"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    TicketsController_list: {
        parameters: {
            query?: {
                /** @description active: still being worked on (default); late: past their deadline; all */
                view?: "active" | "open" | "waiting" | "inspection" | "resolved" | "closed" | "late" | "all";
                type?: "complaint" | "exchange" | "refund" | "delivery_issue" | "return" | "refused";
                orderId?: string;
                /** @description Only tickets assigned to the caller */
                mine?: "true" | "false";
                /** @description Ticket number (T-1001, 1001) or the order's number */
                q?: string;
                limit?: number;
                cursor?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Newest first, with counts per status group; agents see theirs, those they opened and the unassigned queue */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TicketPage"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    TicketsController_create: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewTicket"];
            };
        };
        responses: {
            /** @description Numbered T-1001, T-1002… per store; due in 24 hours; an agent's ticket is assigned to them; audited */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ticket"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    TicketsController_get: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The ticket, its order and its history (newest first) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ticket"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    TicketsController_update: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateTicket"];
            };
        };
        responses: {
            /** @description Status, type, reason, assignee and a note; warehouse adds notes only; a closed ticket only takes notes; audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ticket"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ReturnsController_state: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Each line: how many units came back sellable, damaged or written off, and how many are left */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReturnState"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ReturnsController_inspect: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Inspect"];
            };
        };
        responses: {
            /** @description Recorded: restocked units go back into stock, lost units count on the order's profit; audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReturnState"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ExchangesController_create: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewExchange"];
            };
        };
        responses: {
            /** @description The replacement order (confirmed), the credit moved from the original, what the courier collects or the refund due; audited */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Exchange"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ExchangesController_forOrder: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Exchanges made from this order, and the one it is the replacement of */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderExchanges"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    DoorController_partial: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PartialDelivery"];
            };
        };
        responses: {
            /** @description Delivered in part: what the customer owes now, the cash collected (in the ledger), any refund due, and what comes back; audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PartialDelivered"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    DoorController_refusal: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Refusal"];
            };
        };
        responses: {
            /** @description Why the customer refused at the door, and whether they opened the box (a later call corrects it); audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefusalRecorded"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ShippingController_ship: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Booking queued (booking = pending), or the booking already pending or booked for this order (200); audited */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Shipment"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ShippingController_manual: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManualShipment"];
            };
        };
        responses: {
            /** @description E7-6: a courier without an API — the parcel handed over, recorded with its tracking number; the order is shipped; audited */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Shipment"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    TrackingController_list: {
        parameters: {
            query?: {
                /** @description active: with the courier; review: an unmapped status or a refused booking; delivered; returned (and returning); all */
                view?: "active" | "review" | "delivered" | "returned" | "all";
                /** @description A tracking number or an order number */
                q?: string;
                limit?: number;
                cursor?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Shipments newest first in a view, with counts per view; the area, never the address */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShipmentPage"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    TrackingController_importStatuses: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportShipmentStatuses"];
            };
        };
        responses: {
            /** @description Every row applied as a person's update (audited); any bad line or unknown tracking number: 422 csv_invalid naming each line, nothing saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShipmentStatusesImported"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    TrackingController_history: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every status the shipment had, newest first: from a webhook, a poll, or a person */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShipmentHistory"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    TrackingController_setStatus: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetShipmentStatus"];
            };
        };
        responses: {
            /** @description Set by a person (rule 7: the override for a status Mizan could not map, or a final one); audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShipmentStatusSet"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ScorecardController_get: {
        parameters: {
            query?: {
                /** @description Shipments booked in the last 30, 90 or 180 days */
                days?: number;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Per courier and zone: delivered, returned, still out, delivered rate (the metric layer's formula), days to deliver */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourierScorecard"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StaffController_me: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller as Mizan staff (the first super admin is created from PLATFORM_BOOTSTRAP_EMAILS) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffMe"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StaffController_list: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Everyone on the staff */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffList"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StaffController_add: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddStaff"];
            };
        };
        responses: {
            /** @description Added (they must have signed in to Mizan once) */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Staff"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StaffController_update: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateStaff"];
            };
        };
        responses: {
            /** @description Role or status changed; there is always an active super admin */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Staff"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StaffController_trail: {
        parameters: {
            query?: {
                limit?: number;
                /** @description Older than this line id (the previous page's nextBefore) */
                before?: number;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The staff trail, newest first: every back-office call, refusals included */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaffTrail"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StoresController_list: {
        parameters: {
            query?: {
                /** @description Name, slug or store id */
                q?: string;
                plan?: "free" | "growth" | "scale" | "enterprise";
                status?: "trial" | "active" | "suspended" | "deleted";
                country?: string;
                createdFrom?: string;
                /** @description Inclusive */
                createdTo?: string;
                /** @description orders: the last closed month's orders, most first */
                sort?: "newest" | "orders";
                limit?: number;
                offset?: number;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Find stores by name, plan, status, country, signup date; sort by last month's orders. Deleted stores only when asked for. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformStores"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StoresController_detail: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                storeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One store: team, integrations and their health, jobs and dead letters, usage, internal notes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformStore"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StoresController_suspend: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                storeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SuspendStore"];
            };
        };
        responses: {
            /** @description Suspended: its members are refused (tenant_inactive); jobs and data are kept. Written to the store's audit log. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreState"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StoresController_reactivate: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                storeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReactivateStore"];
            };
        };
        responses: {
            /** @description Active again. Written to the store's audit log. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreState"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StoresController_changePlan: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                storeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePlan"];
            };
        };
        responses: {
            /** @description The store's plan (limits follow at once). Written to the store's audit log; the same plan changes nothing. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreState"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StoresController_addNote: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                storeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddStoreNote"];
            };
        };
        responses: {
            /** @description An internal note about the store (support context); the store never sees it */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreNote"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StaffSupportAccessController_open: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                storeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OpenSupportAccess"];
            };
        };
        responses: {
            /** @description Access to the store's own routes (send its id as X-Tenant-Id) until expiresAt; the store sees it and may end it */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupportGrant"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StaffSupportAccessController_end: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                storeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Your access to this store ends now */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupportAccessEnded"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StaffSupportAccessController_mine: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Your open support access, soonest to end first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupportGrants"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StoreSupportAccessController_list: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Mizan support with open access to this store (for the banner); history is in the audit log */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreSupportAccess"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StoreSupportAccessController_end: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Ends Mizan support's access now (no-op when it already ended) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupportAccessEnded"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    HealthController_overview: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Jobs, events, circuits, drift, database and process, across stores; the same numbers as /metrics */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemHealth"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    HealthController_deadLetters: {
        parameters: {
            query?: {
                storeId?: string;
                kind?: string;
                limit?: number;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Dead-lettered engine jobs across stores, newest first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformDeadLetters"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    HealthController_replay: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Queued again in its store; written to the store's audit log */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformReplayed"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    UsersController_search: {
        parameters: {
            query?: {
                /** @description Email, phone (+20…), name or user id */
                q?: string;
                disabled?: "true" | "false";
                limit?: number;
                offset?: number;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Find people by email, phone, name or id; newest first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformUsers"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    UsersController_detail: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One person and the stores they belong to */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformUser"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    UsersController_disable: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DisableUser"];
            };
        };
        responses: {
            /** @description Every request they make is refused (403 user_disabled); written to their stores' audit logs. Already disabled: unchanged */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformUser"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    UsersController_enable: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description They can sign in again; written to their stores' audit logs */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformUser"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PlatformFlagsController_list: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every flag, for everyone and per store */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformFlags"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PlatformFlagsController_put: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PutFlag"];
            };
        };
        responses: {
            /** @description Created, or changed for every store without its own setting */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformFlag"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PlatformFlagsController_remove: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Gone for every store, with its store settings; code asking for it reads it as off */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PlatformFlagsController_putStore: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                key: string;
                storeId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PutStoreFlag"];
            };
        };
        responses: {
            /** @description The store's own setting; it wins over everyone's */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformFlag"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PlatformFlagsController_clearStore: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                key: string;
                storeId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The store follows everyone's setting again */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformFlag"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PlatformFlagsController_announcements: {
        parameters: {
            query?: {
                live?: "true" | "false";
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Newest first; ?live=true for those not ended */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformAnnouncements"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PlatformFlagsController_announce: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateAnnouncement"];
            };
        };
        responses: {
            /** @description Shown across the dashboard of the stores it targets, in Arabic and English, until endsAt */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformAnnouncement"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PlatformFlagsController_end: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Ended now (kept for the record) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformAnnouncement"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StoreFlagsController_storeFlags: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every flag as it applies to this store (unknown keys are off) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreFlags"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StoreFlagsController_storeAnnouncements: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Announcements from Mizan for this store right now */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreAnnouncements"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    BillingController_get: {
        parameters: {
            query?: {
                /** @description YYYY-MM in the store's time zone; this month if absent */
                month?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A month's orders, messages and AI offers, the stores and users counted, the plan's limits, and the last six months */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Usage"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    BillingController_upgrade: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpgradeRequest"];
            };
        };
        responses: {
            /** @description Recorded; Brandita follows up (event plan.upgrade_requested); audited */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpgradeRequested"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ReportsController_catalogue: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The semantic metric catalogue the caller may see (name and definition in their language) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetricCatalogue"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ReportsController_values: {
        parameters: {
            query?: {
                /** @description Comma-separated metric keys; every metric the caller may see if absent */
                keys?: string;
                /** @description The last 7, 30 or 90 store days, today included (default 30) */
                days?: number;
                /** @description Or a range of store days (with `to`, at most 366) */
                from?: string;
                to?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Values for a period of store days; metrics the caller may not see are left out, never zero */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetricValues"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    DashboardsController_list: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The dashboards the caller has at least one metric on */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DashboardList"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    DashboardsController_get: {
        parameters: {
            query?: {
                /** @description The last 7, 30 or 90 store days, today included (default 30) */
                days?: number;
                /** @description Or a range of store days (with `to`, at most 366) */
                from?: string;
                to?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Tiles and daily series for a period of store days, in the caller's language */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Dashboard"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    DashboardsController_export: {
        parameters: {
            query?: {
                /** @description The last 7, 30 or 90 store days, today included (default 30) */
                days?: number;
                /** @description Or a range of store days (with `to`, at most 366) */
                from?: string;
                to?: string;
                /** @description Excel (default) or CSV (UTF-8 with BOM) */
                format?: "csv" | "xlsx";
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The dashboard as an Excel or CSV file (attachment) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": string;
                    "text/csv": string;
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OpsController_sync: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OpsSync"];
            };
        };
        responses: {
            /** @description One result per op, in the order sent; a replayed opId returns its first outcome */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OpsSyncResult"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    AutomationsController_list: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every automation of the store, oldest first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationList"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    AutomationsController_create: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AutomationInput"];
            };
        };
        responses: {
            /** @description Saved (off unless enabled is true) */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Automation"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    AutomationsController_recipes: {
        parameters: {
            query?: {
                lang?: "ar" | "en";
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Built-in recipes and whether the store installed each */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RecipeList"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    AutomationsController_install: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                key: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InstallRecipe"];
            };
        };
        responses: {
            /** @description Installed as the store's own automation, off until turned on */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Automation"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    AutomationsController_get: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The automation and its last 50 runs */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationDetail"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    AutomationsController_update: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AutomationInput"];
            };
        };
        responses: {
            /** @description Saved as a new version */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Automation"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    AutomationsController_remove: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted with its run log */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    AutomationsController_patch: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AutomationPatch"];
            };
        };
        responses: {
            /** @description Turned on or off */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Automation"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    AutomationsController_test: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DryRun"];
            };
        };
        responses: {
            /** @description Each rule with its actual value, and the steps that would run; nothing is done */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DryRunResult"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    CatalogController_get: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One registry in code; automations are checked against it */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AutomationCatalog"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    NotificationsController_list: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Newest first, with how many are unread */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationList"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    NotificationsController_markRead: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MarkRead"];
            };
        };
        responses: {
            /** @description Marked read for the caller */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Marked"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_home: {
        parameters: {
            query?: {
                /** @description Period: the last 7, 30 or 90 store days, today included */
                days?: number;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description What the store kept over the last 7, 30 or 90 days and yesterday, where it went, cash with couriers, leaks */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfitHome"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_breakdown: {
        parameters: {
            query: {
                /** @description Group by */
                by: "day" | "product" | "store" | "courier" | "country";
                /** @description The last 7, 30 or 90 store days (default 30), unless from/to are given */
                days?: number;
                /** @description First store day (with to: at most 366 days) */
                from?: string;
                /** @description Last store day (default today) */
                to?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Profit by day, product, store, courier or country over a range of store days, with the total */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfitBreakdown"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_adSpend: {
        parameters: {
            query?: {
                /** @description First day (default: 29 days before today) */
                from?: string;
                /** @description Last day (default: today) */
                to?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Spend per day and platform (default last 30 days), each day's share per order, unallocated spend */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdSpendList"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_setAdSpend: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetAdSpend"];
            };
        };
        responses: {
            /** @description The day's spend on that platform (replaces what it had); that day's orders get their new share */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdSpendSet"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_importAdSpend: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportAdSpend"];
            };
        };
        responses: {
            /** @description Every day and platform in the file replaced; any unreadable line: 422 csv_invalid naming each line, nothing saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdSpendImported"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_removeAdSpend: {
        parameters: {
            query?: {
                connectionId?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                day: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description That day's spend on that platform removed */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_orderPnl: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One order's profit: realised components, expected profit, missing inputs */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderPnl"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_recalculate: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Recalculate"];
            };
        };
        responses: {
            /** @description Provisional orders in the range recomputed (up to 2,000 per call) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Recalculated"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_list: {
        parameters: {
            query?: {
                /** @description Rules that apply on this day (default today) */
                at?: string;
                /** @description Every version, newest first */
                history?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Rules that apply on a day (default today), or every version */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CostRuleList"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_create: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCostRule"];
            };
        };
        responses: {
            /** @description The new version; the previous one for the same kind and scope now ends the day before */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CostRule"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_end: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Ended: applies through today, not after (a version that has not started is withdrawn) */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_rates: {
        parameters: {
            query?: {
                /** @description Default today (store time) */
                day?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The store's base currency against USD and the currencies its orders used in the last 90 days */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FxRates"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ProfitController_setRate: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                day: string;
                quote: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SetFxRate"];
            };
        };
        responses: {
            /** @description The store's own rate for that day; it wins over the feed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FxRate"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConfirmationController_summary: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The order's confirmation run, its steps and the answers so far */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderConfirmation"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConfirmationController_answer: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentAnswer"];
            };
        };
        responses: {
            /** @description Confirmed or cancelled by an agent; audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnswerResult"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConfirmationController_link: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The customer's confirm link and a WhatsApp link with the message, to send by hand; audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfirmationLink"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConfirmationController_noAnswer: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The team called and nobody answered: the order leaves the call list until the store's retry time; audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoAnswer"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConfirmationController_connectWhatsApp: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WhatsAppConnect"];
            };
        };
        responses: {
            /** @description Saved (token encrypted) as pending; checked in the background: active when the token works and the confirmation template is approved, else needs_attention (token_refused, token_lacks_permission, template_pending, template_rejected, template_missing) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionView"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConfirmationController_checkWhatsApp: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Check the WhatsApp number again (after a template is approved) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionView"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConfirmationController_queueSummary: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Orders waiting for the team's call: due now, mine, retrying later, unreachable */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CallQueue"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConfirmationController_queueNext: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The next order to call, claimed for the caller (mine first, retries due before new, the unreachable last) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CallQueueNext"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConfirmationController_results: {
        parameters: {
            query?: {
                /** @description Orders placed in the last 7, 30 or 90 days */
                days?: number;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description How confirmation went: rate, time to confirm, by route and by channel (counts only) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfirmationSummary"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConfirmationController_settings: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The store's cascade, waits, calling hours, and which channels are connected */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfirmationSettingsView"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConfirmationController_saveSettings: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConfirmationSettings"];
            };
        };
        responses: {
            /** @description Saved; applies to orders that start confirmation from now on */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfirmationSettingsView"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConfirmationController_preview: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScriptPreviewRequest"];
            };
        };
        responses: {
            /** @description E6-5: the script filled from an order (or a sample): each reply by the button it answers, and the call script */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScriptPreview"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PublicConfirmationController_view: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The order behind a confirm link */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicConfirmation"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PublicConfirmationController_answer: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublicAnswer"];
            };
        };
        responses: {
            /** @description Answered: the order as it is now */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicConfirmation"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Gone (pii_redacted: deleted on request, …) */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OffersController_settings: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Offers on or off, rules or recommendations, discount caps, where they show */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfferSettings"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OffersController_saveSettings: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OfferSettings"];
            };
        };
        responses: {
            /** @description Saved; applies to confirmations that start from now on; audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfferSettings"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OffersController_rules: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The owner's offer rules, active first */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfferRuleList"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OffersController_addRule: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OfferRuleCreate"];
            };
        };
        responses: {
            /** @description Rule added; audited */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Id"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OffersController_setRule: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OfferRuleUpdate"];
            };
        };
        responses: {
            /** @description Stopped or restarted; audited */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OffersController_products: {
        parameters: {
            query?: {
                /** @description Product title or SKU */
                q?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Active products to pick in a rule (100 at most) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfferProducts"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OffersController_summary: {
        parameters: {
            query?: {
                days?: number;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Offers made and taken, and what they added */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfferSummary"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    OffersController_decide: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OfferDecision"];
            };
        };
        responses: {
            /** @description The customer's answer to the offer on the team's call; expired when too late; audited */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfferDecided"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    HealthController_live: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The process is up */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    HealthController_ready: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Ready to serve traffic */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Ready"];
                };
            };
            /** @description A dependency is down */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    MeController_me: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The signed-in user, their stores and invitations waiting for them */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    TenantsController_create: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTenant"];
            };
        };
        responses: {
            /** @description The new store, with the caller as owner */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Tenant"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    TenantsController_current: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Store settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Tenant"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    TenantsController_update: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateTenant"];
            };
        };
        responses: {
            /** @description Changed; audited (tenant.updated). Reports and usage use the new time zone from now on */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Tenant"];
                };
            };
            /** @description Not allowed (not_a_member, insufficient_role, mfa_required) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    MembersController_list: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Members and pending invitations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Team"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    MembersController_invite: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Invite"];
            };
        };
        responses: {
            /** @description The invitation, with a link to share */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Invitation"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    MembersController_remove: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed from the store */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    MembersController_update: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateMember"];
            };
        };
        responses: {
            /** @description The member after the change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Member"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    MembersController_revoke: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Invitation revoked */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    MembersController_accept: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Joined the store */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AcceptedInvitation"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    AuditLogController_list: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
                action?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Newest first; pass nextCursor as cursor for the next page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditLogPage"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConnectionsController_list: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Store, courier and other connections */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Connections"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ConnectionsController_saveBosta: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BostaKey"];
            };
        };
        responses: {
            /** @description Saved; status pending until the key is checked */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Connection"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    IntegrationsAdminController_health: {
        parameters: {
            query?: {
                /** @description Which Shopify store (default: the first) */
                connectionId?: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Connections, and one store's engine queues, dead letters and drift */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntegrationsHealth"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    IntegrationsAdminController_deadLetters: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Jobs that need a person, newest first (every store) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeadLetters"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    IntegrationsAdminController_replay: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Queued again */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Replayed"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    IntegrationsAdminController_resolveCity: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResolveCity"];
            };
        };
        responses: {
            /** @description Saved, and the job replayed when one was given */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CityResolved"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ShopifyConnectController_install: {
        parameters: {
            query: {
                /** @description The store's myshopify.com domain */
                shop: string;
            };
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Shopify's authorize URL */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShopifyInstallStart"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    ShopifyConnectController_claim: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShopifyClaim"];
            };
        };
        responses: {
            /** @description The store is connected (or reconnected) */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ShopifyClaimResult"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StoreSyncController_get: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description What Mizan writes back to this Shopify store as the courier reports */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreSync"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    StoreSyncController_put: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PutStoreSync"];
            };
        };
        responses: {
            /** @description Changed; audited (connection.sync_updated) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreSync"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    WooCommerceConnectController_connect: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WooCommerceKeys"];
            };
        };
        responses: {
            /** @description Saved; pending until the keys are checked (webhooks pointed at Mizan), then the last 60 days of orders are imported; audited */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Connection"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    WooCommerceConnectController_authorize: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WooCommerceAuthorize"];
            };
        };
        responses: {
            /** @description Open it in the browser: the owner approves Read/Write in WooCommerce and comes back to Settings → Integrations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WooCommerceAuthorizeUrl"];
                };
            };
            /** @description Understood but refused (a business rule) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PrivacyController_list: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Newest first, at most 200 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrivacyRequests"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
    PrivacyController_export: {
        parameters: {
            query?: never;
            header?: {
                "Accept-Language"?: "ar" | "en";
                /** @description Store id; required on store routes */
                "X-Tenant-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every download is in the audit log */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrivacyExport"];
                };
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Conflict with the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
            /** @description Problem (RFC 9457) with a stable `code` */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ProblemDetails"];
                };
            };
        };
    };
}
