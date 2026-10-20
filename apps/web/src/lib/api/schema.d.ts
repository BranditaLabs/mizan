/* Generated from apps/api/openapi.json by `npm run gen:api -w @mizan/web`. Do not edit. */

export interface paths {
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
        CityResolved: {
            /** @enum {boolean} */
            saved: true;
            replayed: boolean;
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
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
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
