# Bakery Operations

## A simple guide for the bakery team

This area helps you plan baking, understand the cost of each product, keep track of ingredients, and record what really happened in the kitchen.

You can use it from a laptop, tablet, or phone. The main bakery menu is:

**Overview · Materials · Recipes · Calculator · Production · Inventory · Purchasing · Waste · Reports**

The easiest way to remember it is:

**Set up → Calculate → Plan → Buy → Bake → Record → Review**

## How to open it

Sign in with your admin account and open **Bakery Operations** from the admin menu. Start at **Overview**. On a phone, tap **Menu** to open the navigation. If the bakery menu is closed, tap **Bakery Operations** to expand it.

The **Stay awake** button can keep the screen on while you are baking. The **Ring** button controls the new-order sound; it does not change bakery calculations.

---

## 1. Overview: see what needs attention

The Overview page gives a quick picture of the kitchen:

- production plans coming up
- ingredients that are low or already reserved for a plan
- recent waste cost
- recipes whose cost has changed

Use this page at the start of the day. It tells you what to prepare and what may need to be purchased.

---

## 2. Materials: tell the system what you buy

Materials are the things used in the bakery. They can be:

- ingredients: flour, butter, chocolate, sugar
- packaging: cake boxes, brownie boxes, labels
- labour: a baker or helper and their rate
- resources: oven, mixer, or another timed resource

When adding a material, enter the unit in which you normally use it and the pack in which you buy it.

### Example: flour

Suppose you buy **1 kg flour for ₹58**, and your recipes use grams.

| Field | What to enter |
| --- | --- |
| Name | Flour |
| Type | Ingredient |
| Base unit | g |
| Pack quantity | 1 |
| Pack unit | kg |
| Pack price | ₹58 |

The system automatically understands that 1 kg = 1,000 g and calculates:

**₹58 ÷ 1,000 g = ₹0.058 per gram**

You do not need to calculate price per gram yourself.

### Important material rules

- Use the same base unit consistently. For example, use `g` for flour and `ml` for milk.
- Use `piece`, `box`, or `packet` for countable items.
- Do not convert grams to millilitres unless the material has a measured density. This prevents incorrect costing.
- When a price changes, record a new pack price with its effective date. Do not overwrite the old history.
- Update stock in Inventory. Editing a material does not secretly change the physical stock.

---

## 3. Recipes: save the real kitchen recipe

A recipe is the repeatable method for making one product or one preparation.

Enter:

- recipe name and category
- how many units the batch makes
- finished weight, when useful
- each ingredient and quantity
- packaging, labour, oven or mixer time
- optional instructions and notes

### Example: brownie batch

Imagine one batch makes **12 brownies**:

| Component | Quantity |
| --- | ---: |
| Flour | 500 g |
| Butter | 250 g |
| Chocolate | 300 g |
| Brownie box | 12 pieces |

The system uses the current material prices to show the batch cost and cost per brownie. If the chocolate price changes next month, the live recipe cost changes, but an already-saved production plan keeps its original cost snapshot.

### Sub-recipes

You can use one recipe inside another. For example, a **vanilla frosting** recipe can be used by a **birthday cake** recipe. The system expands the frosting ingredients into the cake cost and prevents circular recipes.

### Custom options

If a product has optional extras, add them as recipe options. For example:

- Add nuts
- Extra frosting
- Chocolate decoration

The calculator adds the selected option to the original recipe cost.

---

## 4. Calculator: answer “how much do I need?”

Use the Calculator when a customer or the kitchen asks for a different quantity.

1. Select a recipe.
2. Enter the number of units, or enter a finished weight when the recipe has one.
3. Add another recipe if several products are being made together.
4. Select any custom options.
5. Choose a pricing method.

The calculator shows:

- ingredient cost
- packaging cost
- labour cost
- resource cost
- other direct cost and overhead
- total production cost
- cost per unit
- suggested selling price
- ingredients needed, stock available, shortage, and packs to buy

### Markup and margin are different

For a batch that costs **₹200**:

| Pricing choice | Selling price | Profit | Gross margin |
| --- | ---: | ---: | ---: |
| 50% markup | ₹300 | ₹100 | 33.33% |
| 30% target margin | ₹285.71 | ₹85.71 | 30% |

Markup adds a percentage to the cost. Margin is the percentage of the final selling price that remains as profit. Choose the method your bakery normally uses; do not treat them as the same thing.

### Save the calculation

Open **Save this calculation** and add:

- a reference, such as `Saturday brownie order`
- an optional person or customer name
- the required date
- internal notes

Choose **Save costing sheet** for a quote or reference. Choose **Save production plan** when the kitchen is going to make it. A production plan reserves the required stock.

---

## 5. Inventory: know what is really available

Inventory shows three useful numbers:

- **On hand:** physically in the kitchen
- **Allocated:** already reserved for scheduled production
- **Available:** on hand minus allocated

### Example

You have **2,000 g flour**. A saved plan needs **1,200 g**.

| Number | Amount |
| --- | ---: |
| On hand | 2,000 g |
| Allocated | 1,200 g |
| Available | 800 g |

When stock enters or leaves, the system keeps a movement record: opening balance, receipt, production use, waste, adjustment, or return.

Use a stock adjustment only when the physical count is different from the system. If someone changed the stock at the same time, the system asks you to reload before replacing the count.

---

## 6. Purchasing: buy only what is short

Open the purchase requirement from a production plan or from Purchasing.

The system compares:

- what the plan requires
- what is available
- the shortage
- pack sizes and minimum order quantity
- suppliers, prices, estimated spend, excess, and lead time

### Example

The plan needs **1,200 g flour** and only **800 g is available**.

Shortage = **400 g**.

If the supplier sells 1 kg packs, the system suggests **1 pack**. It also shows the expected excess of 600 g.

Creating a purchase order does **not** add stock. Stock is added only after the delivery is received.

When a delivery arrives:

1. Open the purchase order.
2. Enter the packs received.
3. Add the lot or expiry date if you use them.
4. Submit the receipt.

Partial deliveries are allowed. Receiving the same delivery again with the same operation key does not double the stock.

---

## 7. Production: record what was actually baked

Production plans start with the quantities from the calculator. Before completing the batch:

1. Open the scheduled plan.
2. Choose **Record production**.
3. Check the planned ingredient quantities.
4. Change a quantity only if the actual kitchen usage was different.
5. Enter usable output and broken or discarded output.
6. Optionally enter before-baking and finished weights to measure process loss.
7. Add a note if there was an unusual event.
8. Complete the batch.

The system then records actual consumption, stock deductions, output, waste, and cost variance. Completing the same batch again does not consume stock twice.

### Example

The plan expected 500 g flour, but the baker used 520 g. Enter 520 g. The production record will show a **+20 g variance** and include the extra cost using the saved historical rate.

If two different lines use the same recipe, each line remains separate so their outputs and waste are not mixed together.

---

## 8. Waste: record loss while it is fresh

Use Waste for ingredients, packaging, production scrap, process loss, and finished products.

For an ingredient or package:

1. Choose the item.
2. Enter the quantity.
3. Choose a reason such as spoilage, burnt, dropped, expired, trim, or incorrect recipe.
4. Add a note if helpful.
5. Record the entry.

The system deducts the quantity from stock and calculates the monetary loss from the correct material rate.

For a finished product, select the completed production batch and product. The system uses that batch's historical unit cost and will not allow more waste than the batch actually produced.

### Example

Two brownies from a batch cost ₹18 each and are damaged. Record **2 pieces** as finished-product waste. The loss is **₹36**, and the batch's remaining usable quantity is reduced by those two pieces.

---

## 9. Reports: learn from the numbers

Reports help with weekly and monthly decisions:

- which recipes became more expensive
- current unit cost and current margin
- planned versus actual ingredient usage
- expected versus actual yield and process loss
- waste by reason and cost
- stock movements
- purchase price history and goods received
- recorded production output

Use Reports during the weekly review. Use Overview for quick daily action.

---

## A simple daily routine

### Before baking

1. Open Overview.
2. Check today's Production plans.
3. Check low stock and allocated stock in Inventory.
4. Review Purchase requirements for anything short.
5. Confirm deliveries in Purchasing before using them.

### During baking

1. Follow the saved recipe and preparation list.
2. Record unusual ingredient changes.
3. Keep damaged items separate so Waste can be recorded accurately.

### After baking

1. Record actual ingredient quantities and usable output in Production.
2. Record broken product, spoiled ingredients, or packaging in Waste.
3. Check that Inventory looks correct.
4. Review Reports when a price, yield, or waste problem keeps repeating.

---

## Good habits that keep the numbers trustworthy

- Enter the pack size and total purchase price; never guess a price per gram.
- Keep grams, millilitres, and pieces separate unless a measured conversion is available.
- Save a production plan before baking so stock can be allocated.
- Receive delivered stock before counting it as available.
- Record actual quantities instead of leaving every plan at its estimate.
- Log waste on the same day.
- Use notes for unusual events, such as `oven stopped after first tray`.
- Ask an admin to correct a recipe or supplier price rather than changing old production records.

## What this feature is for

Bakery Operations is the kitchen's planning and costing notebook. It helps answer four everyday questions:

1. What are we making?
2. What will it cost?
3. Do we have enough ingredients?
4. What actually happened after baking?

It works alongside customer orders. It does not replace the customer order, payment, or invoice screens.
