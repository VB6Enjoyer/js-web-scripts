// Change this number to your maximum budget in ARS
const MAX_PRICE = 3000; 

function hideExpensiveGames() {
    // Find all elements containing text on the page
    const allElements = document.querySelectorAll('div, span, p, a');
    let hiddenCount = 0;

    allElements.forEach(el => {
        // Check if the element contains the specific AR$ format
        if (el.textContent.includes('AR$') && el.children.length === 0) {
            let text = el.textContent;
            
            // If there are two prices, grab the last one (the sale price)
            if (text.includes('AR$')) {
                const prices = text.split('AR$');
                text = prices[prices.length - 1];
            }

            // Clean up the text to isolate the final number
            let priceText = text.replace(/[^\d,.]/g, '').trim();
            
            // Handle thousands separator
            if (priceText.includes('.') && priceText.includes(',')) {
                priceText = priceText.replace(/\./g, '').replace(',', '.');
            } else if (priceText.includes(',')) {
                priceText = priceText.replace(',', '.');
            }
            
            let price = parseFloat(priceText);

            if (!isNaN(price) && price > MAX_PRICE) {
                // Find the game card container
                let card = el.closest('[class*="item"], [class*="card"], [class*="col"], .store-product-item-col');
                
                if (card && card.style.display !== 'none') {
                    card.style.display = 'none';
                    hiddenCount++;
                }
            }
        }
    });

    if (hiddenCount > 0) {
        console.log(`[Budget Filter] Hidden ${hiddenCount} games costing more than ARS$ ${MAX_PRICE}.`);
    }
}

// 1. Run it immediately for the current page
hideExpensiveGames();

// 2. Set up a MutationObserver to watch for page/listing changes
const observer = new MutationObserver((mutations) => {
    // We disconnect briefly to avoid infinite loops if our own hiding triggers the observer
    observer.disconnect();
    
    hideExpensiveGames();
    
    // Reconnect after filtering
    startObserving();
});

function startObserving() {
    // IndieGala stores its listings inside a main content container. 
    // Watching 'document.body' is a safe catch-all for SPA transitions.
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

startObserving();
console.log("Budget Filter is active and watching for page changes!");