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
  /**
   * Fields a variant may ask for that the shop can refuse (an API version without them, or access
   * the app lacks): an error about these only moves on to the next variant instead of failing.
   */
  optional?: string[];
}

const MONEY = `shopMoney { amount currencyCode }`;

const ORDER_BASE = `
  id name createdAt updatedAt cancelledAt displayFinancialStatus paymentGatewayNames tags currencyCode
  email phone
  totalPriceSet { ${MONEY} }
  subtotalPriceSet { ${MONEY} }
  totalShippingPriceSet { ${MONEY} }
  shippingAddress { name firstName lastName phone address1 address2 city province provinceCode zip countryCodeV2 }
  billingAddress { phone }
  lineItems(first: 100) { nodes { id title sku quantity currentQuantity variant { id } originalUnitPriceSet { ${MONEY} } } }
  fulfillmentOrders(first: 10) { nodes { id status lineItems(first: 100) { nodes { id lineItem { id } } } } }
  fulfillments(first: 10) { id status trackingInfo { company number url } }
  sourceIdentifier
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

/** Where the order came from (M7-2): the customer journey, codes, note attributes and the sales channel. */
const VISIT = `landingPage referrerUrl source sourceType occurredAt utmParameters { source medium campaign content term }`;
const ORDER_SOURCE = `sourceName discountCodes customAttributes { key value } customerJourneySummary { ready firstVisit { ${VISIT} } lastVisit { ${VISIT} } }`;
const SOURCE_FIELDS = ["customerJourneySummary", "discountCodes", "customAttributes", "sourceName", "landingPage", "referrerUrl", "utmParameters"];
/** With the source first; a shop that refuses those fields falls back to the variants without them. */
const ORDER_VARIANTS = [`${ORDER_V0} ${ORDER_SOURCE}`, `${ORDER_V1} ${ORDER_SOURCE}`, ORDER_V0, ORDER_V1, ORDER_V2];

export const ORDER_BY_ID: GqlOperation = {
  name: "MizanOrder",
  cost: 40,
  variants: ORDER_VARIANTS.map((f) => `query MizanOrder($id: ID!) { order(id: $id) { ${f} } }`),
  optional: SOURCE_FIELDS,
};

export const ORDERS_UPDATED: GqlOperation = {
  name: "MizanOrders",
  cost: 250,
  optional: SOURCE_FIELDS,
  variants: ORDER_VARIANTS.map(
    (f) => `query MizanOrders($first: Int!, $after: String, $query: String) {
      orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
        pageInfo { hasNextPage endCursor }
        nodes { ${f} }
      }
    }`,
  ),
};

const BASE_PRODUCT_FIELDS = `
  id title status vendor productType tags descriptionHtml updatedAt
  variants(first: 100) { nodes { id sku barcode title price compareAtPrice inventoryQuantity inventoryItem { id inventoryLevels(first: 1) { nodes { location { id } } } } } }
`;

/**
 * The full product (P1): pictures with the main one, options, each variant's option values and
 * picture, the handle and the shop's currency (prices are in it). Variant 1 is the older shape,
 * used if a version refuses any of these.
 */
const PRODUCT_FIELDS = `
  id title handle status vendor productType tags descriptionHtml updatedAt
  priceRangeV2 { minVariantPrice { currencyCode } }
  options { name values }
  featuredMedia { id }
  media(first: 20) { nodes { id mediaContentType alt ... on MediaImage { image { url width height } } } }
  variants(first: 100) { nodes { id sku barcode title price compareAtPrice inventoryQuantity selectedOptions { name value } media(first: 1) { nodes { id } } inventoryItem { id inventoryLevels(first: 1) { nodes { location { id } } } } } }
`;

export const PRODUCT_BY_ID: GqlOperation = {
  name: "MizanProduct",
  cost: 30,
  variants: [
    `query MizanProduct($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`,
    `query MizanProduct($id: ID!) { product(id: $id) { ${BASE_PRODUCT_FIELDS} } }`,
  ],
};

export const PRODUCTS_UPDATED: GqlOperation = {
  name: "MizanProducts",
  cost: 300,
  variants: [PRODUCT_FIELDS, BASE_PRODUCT_FIELDS].map((fields) => `query MizanProducts($first: Int!, $after: String, $query: String) {
      products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
        pageInfo { hasNextPage endCursor }
        nodes { ${fields} }
      }
    }`),
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

/**
 * P2: the pictures in a new order. Moves apply one after another, so moving every picture to its
 * place gives exactly that order (sending it twice changes nothing); the first is the main picture.
 * Shopify reorders in the background (a Job); the next read shows it.
 */
export const PRODUCT_REORDER_MEDIA: GqlOperation = {
  name: "MizanProductReorderMedia",
  cost: 10,
  variants: [
    `mutation MizanProductReorderMedia($id: ID!, $moves: [MoveInput!]!) {
      productReorderMedia(id: $id, moves: $moves) { job { id } mediaUserErrors { field message code } }
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

/** A delivery cancelled at the courier: its fulfillment in the store is cancelled too (the parcel is not coming). */
export const FULFILLMENT_CANCEL: GqlOperation = {
  name: "MizanFulfillmentCancel",
  cost: 10,
  variants: [
    `mutation MizanFulfillmentCancel($id: ID!) { fulfillmentCancel(id: $id) { fulfillment { id status } userErrors { field message } } }`,
  ],
};

/** A fulfillment's tracking link put right (it was made before Mizan knew the courier's link). */
export const FULFILLMENT_TRACKING_UPDATE: GqlOperation = {
  name: "MizanFulfillmentTrackingUpdate",
  cost: 10,
  variants: [
    `mutation MizanFulfillmentTrackingUpdate($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) {
      fulfillmentTrackingInfoUpdate(fulfillmentId: $fulfillmentId, trackingInfoInput: $trackingInfoInput, notifyCustomer: $notifyCustomer) {
        fulfillment { id trackingInfo { company number url } }
        userErrors { field message }
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

/** A fulfillment's tracking events (E7-7): read before writing one, so a retried write never doubles it. */
export const FULFILLMENT_EVENTS: GqlOperation = {
  name: "MizanFulfillmentEvents",
  cost: 5,
  variants: [
    `query MizanFulfillmentEvents($id: ID!) {
      fulfillment(id: $id) { id status events(first: 100) { nodes { id status happenedAt } } }
    }`,
  ],
};

/** One courier step on the customer's order page in Shopify (E7-7). Not idempotent: read first. */
export const FULFILLMENT_EVENT_CREATE: GqlOperation = {
  name: "MizanFulfillmentEventCreate",
  cost: 10,
  variants: [
    `mutation MizanFulfillmentEventCreate($fulfillmentEvent: FulfillmentEventInput!) {
      fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
        fulfillmentEvent { id status happenedAt }
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

export const TAGS_REMOVE: GqlOperation = {
  name: "MizanTagsRemove",
  cost: 10,
  variants: [
    `mutation MizanTagsRemove($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) { node { id } userErrors { field message } }
    }`,
  ],
};

/**
 * Cancel an order (E5-4: bulk cancel, a merged duplicate). Never refunds (money goes back through
 * refunds, with a ledger line) and never emails the customer; restocks. Needs write_orders.
 * Shopify runs the cancellation as a job: the order reads cancelled shortly after. Confirm the
 * 2026-10 shape (orderCancelUserErrors) on a dev store.
 */
export const ORDER_CANCEL: GqlOperation = {
  name: "MizanOrderCancel",
  cost: 10,
  variants: [
    `mutation MizanOrderCancel($orderId: ID!, $reason: OrderCancelReason!, $staffNote: String) {
      orderCancel(orderId: $orderId, reason: $reason, refund: false, restock: true, notifyCustomer: false, staffNote: $staffNote) {
        job { id } orderCancelUserErrors { field message code } userErrors { field message }
      }
    }`,
  ],
};

/**
 * Order editing (E6-13: an accepted offer joins the customer's order). Needs write_order_edits.
 * begin → add the variant → discount it → commit; nothing changes in the store until the commit,
 * and an uncommitted edit is simply abandoned. Confirm the 2026-10 shapes on a dev store.
 */
export const ORDER_EDIT_BEGIN: GqlOperation = {
  name: "MizanOrderEditBegin",
  cost: 10,
  variants: [
    // O3 reads the calculated lines and shipping lines to change them; an offer only needs the id.
    `mutation MizanOrderEditBegin($id: ID!) {
      orderEditBegin(id: $id) { calculatedOrder { id lineItems(first: 100) { nodes { id quantity variant { id } } } shippingLines { id title } } userErrors { field message } }
    }`,
    `mutation MizanOrderEditBegin($id: ID!) {
      orderEditBegin(id: $id) { calculatedOrder { id } userErrors { field message } }
    }`,
  ],
};

export const ORDER_EDIT_ADD_VARIANT: GqlOperation = {
  name: "MizanOrderEditAddVariant",
  cost: 10,
  variants: [
    `mutation MizanOrderEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
      orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity, allowDuplicates: false) {
        calculatedLineItem { id } calculatedOrder { id } userErrors { field message }
      }
    }`,
  ],
};

export const ORDER_EDIT_ADD_DISCOUNT: GqlOperation = {
  name: "MizanOrderEditAddLineItemDiscount",
  cost: 10,
  variants: [
    `mutation MizanOrderEditAddLineItemDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
      orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) { calculatedOrder { id } userErrors { field message } }
    }`,
  ],
};

export const ORDER_EDIT_COMMIT: GqlOperation = {
  name: "MizanOrderEditCommit",
  cost: 10,
  variants: [
    `mutation MizanOrderEditCommit($id: ID!, $notifyCustomer: Boolean, $staffNote: String) {
      orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) { order { id } userErrors { field message } }
    }`,
  ],
};

/**
 * O3: change an order before shipping. Quantities (0 removes the line, restocked), the delivery
 * fee (the old shipping lines removed, one new added; 2024-04+) inside the edit; the address
 * outside it, with orderUpdate. Confirm on a dev store that a CalculatedLineItem carries its
 * LineItem's number (the connector falls back to the variant).
 */
export const ORDER_EDIT_SET_QUANTITY: GqlOperation = {
  name: "MizanOrderEditSetQuantity",
  cost: 10,
  variants: [
    `mutation MizanOrderEditSetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!) {
      orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity, restock: true) { calculatedOrder { id } userErrors { field message } }
    }`,
  ],
};

export const ORDER_EDIT_REMOVE_SHIPPING: GqlOperation = {
  name: "MizanOrderEditRemoveShippingLine",
  cost: 10,
  variants: [
    `mutation MizanOrderEditRemoveShippingLine($id: ID!, $shippingLineId: ID!) {
      orderEditRemoveShippingLine(id: $id, shippingLineId: $shippingLineId) { calculatedOrder { id } userErrors { field message } }
    }`,
  ],
};

export const ORDER_EDIT_ADD_SHIPPING: GqlOperation = {
  name: "MizanOrderEditAddShippingLine",
  cost: 10,
  variants: [
    `mutation MizanOrderEditAddShippingLine($id: ID!, $shippingLine: OrderEditAddShippingLineInput!) {
      orderEditAddShippingLine(id: $id, shippingLine: $shippingLine) { calculatedShippingLine { id } userErrors { field message } }
    }`,
  ],
};

export const ORDER_UPDATE: GqlOperation = {
  name: "MizanOrderUpdate",
  cost: 10,
  variants: [
    `mutation MizanOrderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) { order { id } userErrors { field message } }
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

/**
 * P3: publishing a product made in Mizan. Found first by its handle (a direct read, not the search
 * index, which lags behind a create), then created with its options and pictures (Shopify fetches
 * each picture from its public URL), then its variants.
 */
const CREATED = `id variants(first: 250) { nodes { id sku selectedOptions { name value } } } media(first: 50) { nodes { id } }`;
export const PRODUCT_BY_HANDLE: GqlOperation = {
  name: "MizanProductByHandle",
  cost: 20,
  variants: [
    `query MizanProductByHandle($handle: String!) { product: productByIdentifier(identifier: { handle: $handle }) { ${CREATED} } }`,
    `query MizanProductByHandle($handle: String!) { product: productByHandle(handle: $handle) { ${CREATED} } }`,
  ],
};

export const PRODUCT_CREATE: GqlOperation = {
  name: "MizanProductCreate",
  cost: 20,
  variants: [
    `mutation MizanProductCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) { product { ${CREATED} } userErrors { field message } }
    }`,
  ],
};

export const VARIANTS_CREATE: GqlOperation = {
  name: "MizanVariantsCreate",
  cost: 20,
  variants: [
    `mutation MizanVariantsCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
      productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) { productVariants { id sku selectedOptions { name value } } userErrors { field message } }
    }`,
  ],
};

/**
 * Orders made in Mizan, created in the store: Mizan's id in a unique order metafield (the store
 * refuses a second order with it, and finds the first by it directly, not through the search index
 * that lags behind a create).
 */
export const ORDER_ID_DEFINITION: GqlOperation = {
  name: "MizanOrderIdDefinition",
  cost: 10,
  variants: [
    `mutation MizanOrderIdDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) { createdDefinition { id } userErrors { field message code } }
    }`,
  ],
};

export const ORDER_BY_MIZAN_ID: GqlOperation = {
  name: "MizanOrderByMizanId",
  cost: 2,
  variants: [
    `query MizanOrderByMizanId($value: String!) { order: orderByIdentifier(identifier: { customId: { namespace: "$app:mizan", key: "order_id", value: $value } }) { id name } }`,
  ],
};

export const ORDER_CREATE: GqlOperation = {
  name: "MizanOrderCreate",
  cost: 10,
  variants: [
    `mutation MizanOrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) { order { id name } userErrors { field message } }
    }`,
  ],
};

/** P3: the shop's currency, so a product priced in another one is not published at the wrong prices. */
export const SHOP_CURRENCY: GqlOperation = {
  name: "MizanShopCurrency",
  cost: 1,
  variants: [`query MizanShopCurrency { shop { currencyCode } }`],
};

/** P3: the shop's sales channels, to put a published product on the Online Store (read_publications). */
export const PUBLICATIONS: GqlOperation = {
  name: "MizanPublications",
  cost: 5,
  variants: [`query MizanPublications { publications(first: 50) { nodes { id name catalog { title } } } }`],
};

/** Safe to repeat: a product already on the channel stays on it (write_publications). */
export const PUBLISHABLE_PUBLISH: GqlOperation = {
  name: "MizanPublishablePublish",
  cost: 10,
  variants: [
    `mutation MizanPublishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) { userErrors { field message } }
    }`,
  ],
};

/** A store customer by phone or email (read_customers): an order is attached to it, the record left as it is. */
export const CUSTOMER_FIND: GqlOperation = {
  name: "MizanCustomerFind",
  cost: 2,
  variants: [`query MizanCustomerFind($query: String!) { customers(first: 1, query: $query) { nodes { id } } }`],
};

/** The order's customer and address as Shopify has them (a copy made before customers and codes were sent). */
export const ORDER_CUSTOMER: GqlOperation = {
  name: "MizanOrderCustomer",
  cost: 1,
  variants: [`query MizanOrderCustomer($id: ID!) { order(id: $id) { id customer { id } shippingAddress { firstName lastName phone address1 address2 city provinceCode countryCodeV2 } } }`],
};

/** A new store customer (write_customers). Not idempotent: found first by phone or email. */
export const CUSTOMER_CREATE: GqlOperation = {
  name: "MizanCustomerCreate",
  cost: 10,
  variants: [`mutation MizanCustomerCreate($input: CustomerInput!) { customerCreate(input: $input) { customer { id } userErrors { field message } } }`],
};

/** A customer set on an order (write_orders); setting the same one again changes nothing. */
export const ORDER_CUSTOMER_SET: GqlOperation = {
  name: "MizanOrderCustomerSet",
  cost: 10,
  variants: [`mutation MizanOrderCustomerSet($orderId: ID!, $customerId: ID!) { orderCustomerSet(orderId: $orderId, customerId: $customerId) { order { id } userErrors { field message } } }`],
};

/** Onboarding: the store's own name, currency, timezone and country, so the merchant does not type them. */
export const SHOP_PROFILE: GqlOperation = {
  name: "MizanShopProfile",
  cost: 1,
  variants: [`query MizanShopProfile { shop { name myshopifyDomain currencyCode ianaTimezone billingAddress { countryCodeV2 } primaryDomain { url } } }`],
};

/** The app's Storefront API tokens on the shop (unauthenticated_read_product_listings): one is reused, never one per read. */
export const STOREFRONT_TOKENS: GqlOperation = {
  name: "MizanStorefrontTokens",
  cost: 1,
  variants: [`query MizanStorefrontTokens { shop { storefrontAccessTokens(first: 100) { nodes { id title accessToken } } } }`],
};

export const STOREFRONT_TOKEN_CREATE: GqlOperation = {
  name: "MizanStorefrontTokenCreate",
  cost: 10,
  variants: [`mutation MizanStorefrontTokenCreate($input: StorefrontAccessTokenInput!) {
    storefrontAccessTokenCreate(input: $input) { storefrontAccessToken { id title accessToken } userErrors { field message } } }`],
};

/** Storefront API: the brand the merchant set in Shopify (Settings → Brand). The Admin API has no logo. */
export const STOREFRONT_BRAND: GqlOperation = {
  name: "MizanBrand",
  cost: 1,
  variants: [
    `query MizanBrand { shop { brand { logo { image { url } } squareLogo { image { url } } colors { primary { background } } } } }`,
    `query MizanBrand { shop { brand { logo { image { url } } squareLogo { image { url } } } } }`,
  ],
};
