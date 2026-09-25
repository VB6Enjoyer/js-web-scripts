// ==UserScript==
// @name         Metal-Archives MusicBrainz Integration
// @namespace    https://github.com/VB6Enjoyer/ma-mbz-integration
// @version      2025.6.22.2
// @description  Integrate Metal-Archives with MusicBrainz API
// @author       Muxxer
// @match        https://www.metal-archives.com/bands/*
// @match        https://www.metal-archives.com/band/view/id/*
// @match        https://www.metal-archives.com/artists/*
// @match        https://www.metal-archives.com/labels/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// ==/UserScript==

;(() => {
  // Add custom styles for the buttons
  window.GM_addStyle(`
        .mb-integration-container {
            display: inline-flex;
            gap: 8px;
            align-items: center;
        }

        .mb-button {
            background: linear-gradient(135deg, #ba478f, #8e44ad);
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .mb-button:hover {
            background: linear-gradient(135deg, #a8427e, #7d3c98);
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(186, 71, 143, 0.3);
        }

        .mb-button:active {
            transform: translateY(0);
        }

        .mb-button:visited{
            color: #8a8a8a;
        }

        .mb-button.loading {
            opacity: 0.7;
            cursor: wait;
            position: absolute;
            right: 0;
            padding: 0px 10px;
        }

        .mb-spinner {
            width: 12px;
            height: 12px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top: 2px solid white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        .checking-text {
            margin-left: 7px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .mb-icon {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }
    `)

    // MusicBrainz API configuration
  const MB_API_BASE = "https://musicbrainz.org/ws/2"
  const MB_SEARCH_DELAY = 1000 // Rate limiting
  let lastRequestTime = 0

  // Detect page type and extract information
  function getPageInfo() {
    const url = window.location.href
    const pathname = window.location.pathname

    // Sanitize URL by removing hash fragments and query parameters
    const cleanUrl = `${window.location.protocol}//${window.location.host}${pathname}`

    let pageType, entityName, entityId

    console.log("Current pathname:", pathname)
    console.log("Original URL:", url)
    console.log("Clean URL:", cleanUrl)

    if (pathname.includes("/bands/")) {
      pageType = "artist"
      const titleElement = document.querySelector("h1.band_name a") || document.querySelector("h1.band_name")
      entityName = titleElement ? titleElement.textContent.trim() : ""
      entityId = pathname.split("/").pop()
      console.log("Detected band page:", { entityName, entityId })
    } else if (pathname.includes("/artists/")) {
      pageType = "artist"
      // Try multiple selectors for artist pages
      const titleSelectors = ["h1.artist_name", "h1 a", "h1", ".artist_name", "#artist_info h1", ".float_left h1"]

      let titleElement = null
      for (const selector of titleSelectors) {
        titleElement = document.querySelector(selector)
        if (titleElement) {
          console.log(`Found artist name with selector: ${selector}`)
          break
        }
      }

      entityName = titleElement ? titleElement.textContent.trim() : ""
      entityId = pathname.split("/").pop()
      console.log("Detected artist page:", { entityName, entityId, titleElement })
    } else if (pathname.includes("/labels/")) {
      pageType = "label"
      const titleElement = document.querySelector("h1.label_name") || document.querySelector("h1 a")
      entityName = titleElement ? titleElement.textContent.trim() : ""
      entityId = pathname.split("/").pop()
      console.log("Detected label page:", { entityName, entityId })
    } else if (pathname.includes("/band/view/id/")) {
      pageType = "artist"
      const titleElement =
        document.querySelector("h1.band_name a") ||
        document.querySelector("h1.band_name") ||
        document.querySelector("h1")
      entityName = titleElement ? titleElement.textContent.trim() : ""
      // Extract ID from the URL path
      const pathParts = pathname.split("/")
      entityId = pathParts[pathParts.length - 1]
      // Construct the canonical URL format
      const canonicalUrl = `https://www.metal-archives.com/bands/${encodeURIComponent(entityName)}/${entityId}`
      console.log("Detected band view page:", { entityName, entityId })
      return {
        pageType,
        entityName,
        entityId,
        currentUrl: canonicalUrl, // Use canonical format for comparison
      }
    }

    return {
      pageType,
      entityName,
      entityId,
      currentUrl: cleanUrl, // Use the sanitized URL
    }
  }

  // Rate-limited API request
  function makeAPIRequest(url) {
    return new Promise((resolve, reject) => {
      const now = Date.now()
      const timeSinceLastRequest = now - lastRequestTime
      const delay = Math.max(0, MB_SEARCH_DELAY - timeSinceLastRequest)

      setTimeout(() => {
        lastRequestTime = Date.now()

        window.GM_xmlhttpRequest({
          method: "GET",
          url: url,
          headers: {
            "User-Agent": "MetalArchivesMBIntegration/2.0 (https://github.com/user/repo)",
            Accept: "application/json",
          },
          onload: (response) => {
            if (response.status === 200) {
              try {
                const data = JSON.parse(response.responseText)
                resolve(data)
              } catch (e) {
                reject(new Error("Failed to parse JSON response"))
              }
            } else if (response.status === 404) {
              resolve(null) // Not found is a valid response
            } else {
              reject(new Error(`HTTP ${response.status}: ${response.statusText}`))
            }
          },
          onerror: (error) => {
            reject(new Error("Network error"))
          },
          ontimeout: () => {
            reject(new Error("Request timeout"))
          },
          timeout: 15000,
        })
      }, delay)
    })
  }

  // Search MusicBrainz by name and then check URL relationships
  async function searchMusicBrainzByURL(pageInfo) {
    const { pageType, currentUrl, entityName } = pageInfo

    try {
      console.log(`Searching MusicBrainz for: ${entityName} (${pageType})`)

      // First, search by name to get potential candidates
      // MusicBrainz API uses 'artist' for both bands and individual artists
      const mbEntityType = pageType === "artist" ? "artist" : pageType
      const searchUrl = `${MB_API_BASE}/${mbEntityType}?query=${encodeURIComponent(entityName)}&fmt=json&limit=25`
      const searchData = await makeAPIRequest(searchUrl)

      const resultsKey = mbEntityType + "s"
      if (!searchData || !searchData[resultsKey] || searchData[resultsKey].length === 0) {
        console.log("No entities found by name search")
        return { found: false }
      }

      console.log(`Found ${searchData[resultsKey].length} potential matches`)

      // Check each candidate for Metal-Archives URL relationships
      for (const entity of searchData[resultsKey]) {
        try {
          console.log(`Checking entity: ${entity.name} (${entity.id})`)

          // Fetch detailed information including URL relationships
          const detailUrl = `${MB_API_BASE}/${mbEntityType}/${entity.id}?inc=url-rels&fmt=json`
          const detailData = await makeAPIRequest(detailUrl)

          if (!detailData) {
            console.log(`No detail data for ${entity.id}`)
            continue
          }

          // Check if this entity has the Metal-Archives URL
          if (detailData.relations && detailData.relations.length > 0) {
            const metalArchivesRelation = detailData.relations.find((relation) => {
              if (!relation.url || !relation.url.resource) return false

              const relationUrl = relation.url.resource
              console.log(`Checking relation URL: ${relationUrl}`)

              // Sanitize the relation URL as well for comparison
              const cleanRelationUrl = relationUrl.split("#")[0].split("?")[0]
              const cleanCurrentUrl = currentUrl.split("#")[0].split("?")[0]

              // Check for exact match of clean URLs
              if (cleanRelationUrl === cleanCurrentUrl) {
                return true
              }

              // Check if both URLs are from metal-archives.com and have the same ID
              if (relationUrl.includes("metal-archives.com") && currentUrl.includes("metal-archives.com")) {
                const relationId = relationUrl.split("/").pop().split("#")[0].split("?")[0]
                const currentId = currentUrl.split("/").pop().split("#")[0].split("?")[0]
                return relationId === currentId
              }

              return false
            })

            if (metalArchivesRelation) {
              console.log(`Found matching entity: ${detailData.name} (${detailData.id})`)
              return {
                found: true,
                entity: detailData,
              }
            }
          }
        } catch (detailError) {
          console.warn(`Error fetching details for ${entity.id}:`, detailError)
          continue
        }
      }

      console.log("No matching Metal-Archives URLs found in any entity")
      return { found: false }
    } catch (error) {
      console.error("MusicBrainz search error:", error)
      return { found: false, error: error.message }
    }
  }

  // Create SVG icons
  function createIcon(type) {
    const icons = {
      musicbrainz: `<svg class="mb-icon" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm3.5 6L8 10.5 4.5 6h7z"/></svg>`,
      add: `<svg class="mb-icon" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm4 9H9v3H7V9H4V7h3V4h2v3h3v2z"/></svg>`,
      search: `<svg class="mb-icon" viewBox="0 0 16 16"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>`,
    }
    return icons[type] || ""
  }

  // Create buttons based on search results
  function createButtons(pageInfo, searchResult) {
    const container = document.createElement("div")
    container.className = "mb-integration-container"

    if (searchResult.found && searchResult.entity && searchResult.entity.id) {
      // Create "View in MusicBrainz" button
      const viewButton = document.createElement("a")
      viewButton.href = `https://musicbrainz.org/${pageInfo.pageType}/${searchResult.entity.id}`
      viewButton.className = "mb-button"
      viewButton.target = "_blank"
      viewButton.title = `View ${searchResult.entity.name} in MusicBrainz`
      viewButton.innerHTML = `${createIcon("musicbrainz")} MusicBrainz`
      container.appendChild(viewButton)
    } else {
      // Create "Add to MusicBrainz" button
      const addButton = document.createElement("a")
      addButton.className = "mb-button"
      addButton.href = generateAddURL(pageInfo)
      addButton.target = "_blank"
      addButton.title = "Add to MusicBrainz"
      addButton.innerHTML = `${createIcon("add")} Add to MB`
      container.appendChild(addButton)

      // Create "Search MusicBrainz" button
      const searchButton = document.createElement("a")
      searchButton.className = "mb-button"
      searchButton.href = `https://musicbrainz.org/search?query=${encodeURIComponent(pageInfo.entityName)}&type=${pageInfo.pageType}&method=indexed`
      searchButton.target = "_blank"
      searchButton.title = "Search MusicBrainz"
      searchButton.innerHTML = `${createIcon("search")} Search MB`
      container.appendChild(searchButton)
    }

    return container
  }

  // Generate URL for adding new entry to MusicBrainz
  function generateAddURL(pageInfo) {
    const { pageType, entityName, currentUrl } = pageInfo

    // Extract additional metadata from the page
    const metadata = extractMetadata(pageType)

    // MusicBrainz URLs always use 'artist' for both bands and individual artists
    const mbUrlType = pageType === "artist" ? "artist" : pageType
    let addUrl = `https://musicbrainz.org/${mbUrlType}/create`
    const params = new URLSearchParams()

    if (entityName) {
      params.append("name", entityName)
    }

    // Add page-specific metadata
    if (pageType === "artist") {
      if (metadata.country) params.append("country", metadata.country)
      if (metadata.type) params.append("type", metadata.type)
      if (metadata.beginDate) params.append("begin_date", metadata.beginDate)
      if (metadata.endDate) params.append("end_date", metadata.endDate)
    } else if (pageType === "label") {
      if (metadata.country) params.append("country", metadata.country)
      if (metadata.type) params.append("type", metadata.type)
    }

    if (params.toString()) {
      addUrl += "?" + params.toString()
    }

    return addUrl
  }

  // Extract metadata from Metal-Archives page
  function extractMetadata(pageType) {
    const metadata = {}

    try {
      if (pageType === "artist") {
        // Extract country - try multiple selectors
        const countrySelectors = [
          'dt:contains("Country of origin") + dd',
          'dt:contains("Country") + dd',
          '.float_left dt:contains("Country") + dd',
        ]

        for (const selector of countrySelectors) {
          try {
            const elements = document.querySelectorAll("dt")
            for (const dt of elements) {
              if (dt.textContent.includes("Country")) {
                const dd = dt.nextElementSibling
                if (dd && dd.tagName === "DD") {
                  metadata.country = dd.textContent.trim()
                  break
                }
              }
            }
            if (metadata.country) break
          } catch (e) {
            continue
          }
        }

        // Extract formed/active dates
        const dateElements = document.querySelectorAll("dt")
        for (const dt of dateElements) {
          if (dt.textContent.includes("Formed") || dt.textContent.includes("Active")) {
            const dd = dt.nextElementSibling
            if (dd && dd.tagName === "DD") {
              const dateText = dd.textContent.trim()
              const dateMatch = dateText.match(/(\d{4})/)
              if (dateMatch) {
                metadata.beginDate = dateMatch[1]
                break
              }
            }
          }
        }

        // Determine if it's a band or person
        if (window.location.pathname.includes("/bands/")) {
          metadata.type = "Group"
        } else if (window.location.pathname.includes("/artists/")) {
          metadata.type = "Person"
        }
      } else if (pageType === "label") {
        // Extract country for labels
        const dateElements = document.querySelectorAll("dt")
        for (const dt of dateElements) {
          if (dt.textContent.includes("Country")) {
            const dd = dt.nextElementSibling
            if (dd && dd.tagName === "DD") {
              metadata.country = dd.textContent.trim()
              break
            }
          }
        }
        metadata.type = "Original Production"
      }
    } catch (error) {
      console.warn("Error extracting metadata:", error)
    }

    return metadata
  }

  // Create loading button
  function createLoadingButton() {
    const container = document.createElement("div")
    container.className = "mb-integration-container"

    const loadingButton = document.createElement("div")
    loadingButton.className = "mb-button loading"
    loadingButton.innerHTML = `<div class="mb-spinner"></div> Checking MB...`
    container.appendChild(loadingButton)

    return container
  }

  // Find the best location to insert buttons
  function findInsertionPoint() {
    console.log("Looking for insertion point...")

    // Try different selectors based on page type
    const selectors = [
      "h1.band_name",
      "h1.artist_name",
      "h1.label_name",
      "h1 a",
      "h1",
      ".artist_name",
      "#artist_info h1",
      ".float_left h1",
    ]

    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (element) {
        console.log(`Found insertion point with selector: ${selector}`, element)
        return element.parentElement || element
      }
    }

    // If no specific selectors work, try to find any h1
    const anyH1 = document.querySelector("h1")
    if (anyH1) {
      console.log("Using fallback h1 element:", anyH1)
      return anyH1.parentElement || anyH1
    }

    console.log("No insertion point found")
    return null
  }

  // Main execution function
  async function main() {
    console.log("Script starting...")
    console.log("Page readyState:", document.readyState)
    console.log("Available h1 elements:", document.querySelectorAll("h1"))

    const pageInfo = getPageInfo()

    if (!pageInfo.pageType || !pageInfo.entityName) {
      console.log("Could not determine page type or entity name:", pageInfo)
      // Let's see what elements are available
      console.log("Available elements:")
      console.log("- h1 elements:", document.querySelectorAll("h1"))
      console.log("- Elements with 'artist':", document.querySelectorAll("*[class*='artist']"))
      console.log("- Elements with 'name':", document.querySelectorAll("*[class*='name']"))
      return
    }

    console.log("Processing page:", pageInfo)

    const insertionPoint = findInsertionPoint()
    if (!insertionPoint) {
      console.log("Could not find insertion point for buttons")
      return
    }

    // Show loading state
    const loadingContainer = createLoadingButton()
    insertionPoint.appendChild(loadingContainer)

    try {
      // Search MusicBrainz
      const searchResult = await searchMusicBrainzByURL(pageInfo)

      // Remove loading container
      loadingContainer.remove()

      // Create and insert appropriate buttons
      const buttonsContainer = createButtons(pageInfo, searchResult)
      insertionPoint.appendChild(buttonsContainer)

      console.log("MusicBrainz integration complete:", searchResult)
    } catch (error) {
      console.error("Error during MusicBrainz integration:", error)

      // Remove loading and show error state
      loadingContainer.remove()

      const errorContainer = document.createElement("div")
      errorContainer.className = "mb-integration-container"
      errorContainer.innerHTML = `<span style="color: #e74c3c; font-size: 12px;">MB check failed</span>`
      insertionPoint.appendChild(errorContainer)
    }
  }

  // Wait for page to load and then execute
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main)
  } else {
    // Page already loaded
    setTimeout(main, 500) // Small delay to ensure all elements are rendered
  }
})()
