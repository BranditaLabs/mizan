/* Generated from apps/api/openapi.json by `npm run gen:api -w @mizan/web`. Do not edit. */

export interface paths {
    "/v1/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["OrdersController_list"];
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
        patch?: never;
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
        AgentAnswer: {
            /** @enum {string} */
            answer: "confirm" | "cancel";
            /** @enum {string} */
            reason?: "changed_mind" | "ordered_by_mistake" | "found_cheaper" | "delivery_too_late" | "other";
            note?: string;
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
        BostaKey: {
            /** @description From Bosta's dashboard (Settings → API integration); stored encrypted, never shown again */
            apiKey: string;
        };
        CityResolved: {
            /** @enum {boolean} */
            saved: true;
            replayed: boolean;
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
                channel: "whatsapp" | "sms" | "voice";
                /** @description How long to wait for an answer before the next step */
                waitMinutes: number;
            }[];
            callingHours: {
                start: string;
                end: string;
            };
            /** @description How long the customer's confirm link works */
            linkHours: number;
        };
        ConfirmationSettingsView: {
            settings: {
                /** @description Start a confirmation for every new cash-on-delivery order */
                enabled: boolean;
                steps: {
                    /** @enum {string} */
                    channel: "whatsapp" | "sms" | "voice";
                    /** @description How long to wait for an answer before the next step */
                    waitMinutes: number;
                }[];
                callingHours: {
                    start: string;
                    end: string;
                };
                /** @description How long the customer's confirm link works */
                linkHours: number;
            };
            /** @description Channels a messaging vendor is connected for */
            channels: {
                whatsapp: boolean;
                sms: boolean;
                voice: boolean;
            };
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
            /** @description key_refused, key_lacks_permission, app_uninstalled … */
            reason: string | null;
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
                /** @description key_refused, key_lacks_permission, app_uninstalled … */
                reason: string | null;
                /** Format: date-time */
                verifiedAt: string | null;
                /** Format: date-time */
                updatedAt: string;
            }[];
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
        CostsUpdated: {
            updated: number;
            missingCost: number;
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
        Money: {
            amount: string;
            currency: string;
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
                    channel: "whatsapp" | "sms" | "voice";
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
            /** @description Channels a messaging vendor is connected for */
            channels: {
                whatsapp: boolean;
                sms: boolean;
                voice: boolean;
            };
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
            }[];
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
                };
            }[];
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
        Ready: {
            /** @enum {string} */
            status: "ready";
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
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    OrdersController_list: {
        parameters: {
            query?: {
                status?: "new" | "pending_confirmation" | "confirmed" | "cancelled" | "shipped" | "delivered" | "returned";
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
            /** @description Connections, engine queues, dead letters and drift */
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
            /** @description Jobs that need a person, newest first */
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
