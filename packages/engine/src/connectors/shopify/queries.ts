/**
 * GraphQL documents, each with ordered variants.
 *
 * Shopify releases an API version every quarter and retires fields. If the
 * primary document is rejected because a field no longer exists (or the shop
 * was moved to a different version), the client tries the next variant and
 * records drift. Variant 0 targets the pinned version (2026-10); later
 * variants use older or simpler field sets.
 */

export interface GqlOperation {
  name: string;
  /** Estimated cost in points, reserved in the limiter before sending. */
  cost: number;
  variants: string[];
}

const MONEY = `shopMoney { amount currencyCode }`;

const ORDER_BASE = `
  id name createdAt updatedAt cancelledAt displayFinancialStatus paymentGatewayNames tags currencyCode
  email phone
  totalPriceSet { ${MONEY} }
  subtotalPriceSet { ${MONEY} }
  totalShippingPriceSet { ${MONEY} }
  shippingAddress { name firstName lastName phone address1 address2 city province zip countryCodeV2 }
  lineItems(first: 100) { nodes { id title sku quantity variant { id } originalUnitPriceSet { ${MONEY} } } }
  fulfillmentOrders(first: 10) { nodes { id status lineItems(first: 100) { nodes { id lineItem { id } } } } }
  fulfillments(first: 10) { id status trackingInfo { company number url } }
`;

/** What was received, what is still owed, what was refunded: the basis for COD amounts and payment status. */
const ORDER_MONEY = `
  totalReceivedSet { ${MONEY} }
  totalOutstandingSet { ${MONEY} }
  totalRefundedSet { ${MONEY} }
`;
const ORDER_CORE = `${ORDER_BASE} ${ORDER_MONEY}`;

const ORDER_V0 = `${ORDER_CORE} customer { displayName firstName lastName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } }`;
const ORDER_V1 = `${ORDER_CORE} customer { displayName firstName lastName email phone }`;
/** Last resort for shops on versions without the money fields: the mapper derives amounts from status. */
const ORDER_V2 = `${ORDER_BASE} customer { displayName firstName lastName email phone }`;

export const ORDER_BY_ID: GqlOperation = {
  name: "MizanOrder",
  cost: 40,
  variants: [ORDER_V0, ORDER_V1, ORDER_V2].map((f) => `query MizanOrder($id: ID!) { order(id: $id) { ${f} } }`),
};

export const ORDERS_UPDATED: GqlOperation = {
  name: "MizanOrders",
  cost: 250,
  variants: [ORDER_V0, ORDER_V1, ORDER_V2].map(
    (f) => `query MizanOrders($first: Int!, $after: String, $query: String) {
      orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
        pageInfo { hasNextPage endCursor }
        nodes { ${f} }
      }
    }`,
  ),
};

const PRODUCT_FIELDS = `
  id title status vendor productType tags descriptionHtml updatedAt
  variants(first: 100) { nodes { id sku title price compareAtPrice inventoryQuantity inventoryItem { id } } }
`;

export const PRODUCT_BY_ID: GqlOperation = {
  name: "MizanProduct",
  cost: 20,
  variants: [`query MizanProduct($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`],
};

export const PRODUCTS_UPDATED: GqlOperation = {
  name: "MizanProducts",
  cost: 200,
  variants: [
    `query MizanProducts($first: Int!, $after: String, $query: String) {
      products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
        pageInfo { hasNextPage endCursor }
        nodes { ${PRODUCT_FIELDS} }
      }
    }`,
  ],
};

export const INVENTORY_LEVEL: GqlOperation = {
  name: "MizanInventoryLevel",
  cost: 5,
  variants: [
    `query MizanInventoryLevel($id: ID!, $locationId: ID!) {
      inventoryItem(id: $id) { id inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } } }
    }`,
  ],
};

export const PRODUCT_UPDATE: GqlOperation = {
  name: "MizanProductUpdate",
  cost: 10,
  variants: [
    `mutation MizanProductUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) { product { id updatedAt } userErrors { field message } }
    }`,
  ],
};

export const VARIANTS_UPDATE: GqlOperation = {
  name: "MizanVariantsUpdate",
  cost: 10,
  variants: [
    `mutation MizanVariantsUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price compareAtPrice }
        userErrors { field message }
      }
    }`,
  ],
};

/**
 * Inventory writes are compare-and-set and carry an idempotency key, which
 * Shopify requires on this mutation since 2026-04. Variant 0 uses
 * changeFromQuantity; variant 1 falls back to compareQuantity.
 */
export const INVENTORY_SET: GqlOperation = {
  name: "MizanInventorySet",
  cost: 10,
  variants: [
    `mutation MizanInventorySet($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup { id }
        userErrors { field message code }
      }
    }`,
  ],
};

export const FULFILLMENT_CREATE: GqlOperation = {
  name: "MizanFulfillmentCreate",
  cost: 10,
  variants: [
    `mutation MizanFulfillmentCreate($fulfillment: FulfillmentInput!) {
      fulfillmentCreate(fulfillment: $fulfillment) {
        fulfillment { id status trackingInfo { company number url } }
        userErrors { field message }
      }
    }`,
  ],
};

export const ORDER_MARK_PAID: GqlOperation = {
  name: "MizanOrderMarkPaid",
  cost: 10,
  variants: [
    `mutation MizanOrderMarkPaid($input: OrderMarkAsPaidInput!) {
      orderMarkAsPaid(input: $input) { order { id displayFinancialStatus } userErrors { field message } }
    }`,
  ],
};

export const TAGS_ADD: GqlOperation = {
  name: "MizanTagsAdd",
  cost: 10,
  variants: [
    `mutation MizanTagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
    }`,
  ],
};

/**
 * Webhook subscriptions of this app on this shop (the API only returns our own).
 * `uri` replaced `endpoint { callbackUrl }` in 2025-04; variant 1 keeps the older shape.
 */
export const WEBHOOK_SUBSCRIPTIONS: GqlOperation = {
  name: "MizanWebhookSubscriptions",
  cost: 5,
  variants: [
    `query MizanWebhookSubscriptions($first: Int!) { webhookSubscriptions(first: $first) { nodes { id topic uri } } }`,
    `query MizanWebhookSubscriptions($first: Int!) { webhookSubscriptions(first: $first) { nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`,
  ],
};

export const WEBHOOK_CREATE: GqlOperation = {
  name: "MizanWebhookCreate",
  cost: 10,
  variants: [
    `mutation MizanWebhookCreate($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id } userErrors { field message } }
    }`,
  ],
};

export const WEBHOOK_DELETE: GqlOperation = {
  name: "MizanWebhookDelete",
  cost: 10,
  variants: [
    `mutation MizanWebhookDelete($id: ID!) {
      webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { field message } }
    }`,
  ],
};
