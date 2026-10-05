local MessagingService = game:GetService("MessagingService")
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")

local TOPIC = "auction-awards-v1"
local InventoryStore = DataStoreService:GetDataStore("AuctionInventory_v1")

-- Thay catalog này bằng item key của game bạn.
local AwardCatalog = {
	TEST_ITEM_001 = { itemKey = "TEST_ITEM_001" },
}

local function normalizeProfile(profile)
	if type(profile) ~= "table" then profile = {} end
	if type(profile.items) ~= "table" then profile.items = {} end
	if type(profile.receipts) ~= "table" then profile.receipts = {} end
	return profile
end

local function grantAtomic(userId, deliveryId, catalogKey, quantity)
	local award = AwardCatalog[catalogKey]
	if not award then
		return false, "UNKNOWN_CATALOG_KEY"
	end

	local grantedNow = false
	local dataKey = "user:" .. tostring(userId)

	local ok, result = pcall(function()
		return InventoryStore:UpdateAsync(dataKey, function(old)
			local profile = normalizeProfile(old)

			-- deliveryId chống retry phát item hai lần.
			if profile.receipts[deliveryId] then
				return profile
			end

			local key = award.itemKey
			profile.items[key] = (tonumber(profile.items[key]) or 0) + quantity
			profile.receipts[deliveryId] = os.time()
			grantedNow = true
			return profile
		end)
	end)

	if not ok then
		return false, tostring(result)
	end

	return true, grantedNow and "GRANTED" or "ALREADY_DELIVERED"
end

local function notifyOnlinePlayer(userId, payload)
	local player = Players:GetPlayerByUserId(userId)
	if not player then return end

	local remote = ReplicatedStorage:FindFirstChild("AuctionAwarded")
	if remote and remote:IsA("RemoteEvent") then
		remote:FireClient(player, payload)
	end
end

local function handleMessage(message)
	local okDecode, payload = pcall(function()
		return HttpService:JSONDecode(message.Data)
	end)

	if not okDecode or type(payload) ~= "table" then
		warn("[AuctionDelivery] invalid JSON")
		return
	end

	if payload.version ~= "auction-award-v1" then return end

	local deliveryId = tostring(payload.deliveryId or "")
	local robloxUsername = tostring(payload.robloxUsername or "")
	local catalogKey = tostring(payload.catalogKey or "")
	local quantity = math.clamp(tonumber(payload.quantity) or 1, 1, 100)

	if deliveryId == "" or robloxUsername == "" or catalogKey == "" then
		warn("[AuctionDelivery] missing required fields")
		return
	end

	local okUser, userId = pcall(function()
		return Players:GetUserIdFromNameAsync(robloxUsername)
	end)

	if not okUser then
		warn("[AuctionDelivery] username not found:", robloxUsername)
		return
	end

	local okGrant, status = grantAtomic(userId, deliveryId, catalogKey, quantity)

	if not okGrant then
		warn("[AuctionDelivery] grant failed:", status)
		return
	end

	print("[AuctionDelivery]", status, robloxUsername, catalogKey, quantity, deliveryId)

	notifyOnlinePlayer(userId, {
		deliveryId = deliveryId,
		catalogKey = catalogKey,
		quantity = quantity,
		status = status,
	})
end

local ok, result = pcall(function()
	return MessagingService:SubscribeAsync(TOPIC, handleMessage)
end)

if ok then
	print("[AuctionDelivery] listening:", TOPIC)
else
	warn("[AuctionDelivery] SubscribeAsync failed:", result)
end
