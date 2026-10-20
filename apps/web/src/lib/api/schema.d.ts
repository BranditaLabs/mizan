/* Generated from apps/api/openapi.json by `npm run gen:api -w @mizan/web`. Do not edit. */

export interface paths {
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
        CostsUpdated: {
            updated: number;
            missingCost: number;
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
        SetCosts: {
            items: {
                /** Format: uuid */
                variantId: string;
                cost: string;
            }[];
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
