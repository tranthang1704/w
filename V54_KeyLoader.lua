-- Dkhanggggg Script mm2 - V54 Key System
-- Client-side access gate. No server remotes are used.
-- The public key database stores SHA-256 hashes, not plaintext keys.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local CoreGui = game:GetService("CoreGui")

local LP = Players.LocalPlayer
local KEY_DB_URL = "https://raw.githubusercontent.com/tranthang1704/w/main/V54_keys.json"
local PAYLOAD_URL = "https://raw.githubusercontent.com/tranthang1704/w/main/MM2_V53_Dkhanggggg_OneLine.lua"
local KEY_FILE = "Dkhanggggg_mm2_key.txt"

local MOD = 4294967296
local band, bxor, bnot = bit32.band, bit32.bxor, bit32.bnot
local rshift, rrotate = bit32.rshift, bit32.rrotate

local K = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
}

local function sha256(msg)
    msg = tostring(msg or "")
    local bytes = {string.byte(msg,1,#msg)}
    local bitLen = #bytes * 8

    bytes[#bytes+1] = 0x80
    while (#bytes % 64) ~= 56 do
        bytes[#bytes+1] = 0
    end

    for i = 7,0,-1 do
        bytes[#bytes+1] = math.floor(bitLen / (2 ^ (i * 8))) % 256
    end

    local h0,h1,h2,h3 = 0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a
    local h4,h5,h6,h7 = 0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19

    for chunk = 1,#bytes,64 do
        local w = {}

        for i = 1,16 do
            local j = chunk + (i-1)*4
            w[i] = (
                bytes[j] * 16777216
                + bytes[j+1] * 65536
                + bytes[j+2] * 256
                + bytes[j+3]
            ) % MOD
        end

        for i = 17,64 do
            local s0 = bxor(
                rrotate(w[i-15],7),
                rrotate(w[i-15],18),
                rshift(w[i-15],3)
            )
            local s1 = bxor(
                rrotate(w[i-2],17),
                rrotate(w[i-2],19),
                rshift(w[i-2],10)
            )
            w[i] = (w[i-16] + s0 + w[i-7] + s1) % MOD
        end

        local a,b,c,d,e,f,g,h = h0,h1,h2,h3,h4,h5,h6,h7

        for i = 1,64 do
            local S1 = bxor(rrotate(e,6), rrotate(e,11), rrotate(e,25))
            local ch = bxor(band(e,f), band(bnot(e),g))
            local t1 = (h + S1 + ch + K[i] + w[i]) % MOD
            local S0 = bxor(rrotate(a,2), rrotate(a,13), rrotate(a,22))
            local maj = bxor(band(a,b), band(a,c), band(b,c))
            local t2 = (S0 + maj) % MOD

            h = g
            g = f
            f = e
            e = (d + t1) % MOD
            d = c
            c = b
            b = a
            a = (t1 + t2) % MOD
        end

        h0 = (h0 + a) % MOD
        h1 = (h1 + b) % MOD
        h2 = (h2 + c) % MOD
        h3 = (h3 + d) % MOD
        h4 = (h4 + e) % MOD
        h5 = (h5 + f) % MOD
        h6 = (h6 + g) % MOD
        h7 = (h7 + h) % MOD
    end

    return string.format(
        "%08x%08x%08x%08x%08x%08x%08x%08x",
        h0,h1,h2,h3,h4,h5,h6,h7
    )
end

local function guiParent()
    local ok, parent = pcall(function()
        if type(gethui) == "function" then
            return gethui()
        end
    end)
    if ok and parent then return parent end

    local probe = Instance.new("ScreenGui")
    local okCore = pcall(function()
        probe.Parent = CoreGui
    end)
    if okCore and probe.Parent == CoreGui then
        probe:Destroy()
        return CoreGui
    end
    pcall(function() probe:Destroy() end)

    return LP:WaitForChild("PlayerGui")
end

local PARENT = guiParent()
local old = PARENT:FindFirstChild("DkhangggggV54Key")
if old then old:Destroy() end

local sg = Instance.new("ScreenGui")
sg.Name = "DkhangggggV54Key"
sg.ResetOnSpawn = false
sg.DisplayOrder = 999999
sg.Parent = PARENT

local main = Instance.new("Frame")
main.Size = UDim2.fromOffset(430,230)
main.Position = UDim2.new(0.5,-215,0.5,-115)
main.BackgroundColor3 = Color3.fromRGB(19,19,24)
main.BorderSizePixel = 0
main.Parent = sg

local mc = Instance.new("UICorner")
mc.CornerRadius = UDim.new(0,10)
mc.Parent = main

local stroke = Instance.new("UIStroke")
stroke.Color = Color3.fromRGB(55,55,68)
stroke.Thickness = 1
stroke.Parent = main

local title = Instance.new("TextLabel")
title.Size = UDim2.new(1,-28,0,46)
title.Position = UDim2.fromOffset(14,8)
title.BackgroundTransparency = 1
title.Text = "Dkhanggggg Script mm2"
title.TextColor3 = Color3.fromRGB(245,245,248)
title.TextXAlignment = Enum.TextXAlignment.Left
title.Font = Enum.Font.GothamBold
title.TextSize = 20
title.Parent = main

local sub = Instance.new("TextLabel")
sub.Size = UDim2.new(1,-28,0,24)
sub.Position = UDim2.fromOffset(14,47)
sub.BackgroundTransparency = 1
sub.Text = "V54 KEY SYSTEM"
sub.TextColor3 = Color3.fromRGB(160,160,174)
sub.TextXAlignment = Enum.TextXAlignment.Left
sub.Font = Enum.Font.Gotham
sub.TextSize = 12
sub.Parent = main

local box = Instance.new("TextBox")
box.Size = UDim2.new(1,-28,0,44)
box.Position = UDim2.fromOffset(14,82)
box.BackgroundColor3 = Color3.fromRGB(31,31,39)
box.BorderSizePixel = 0
box.PlaceholderText = "Enter key..."
box.PlaceholderColor3 = Color3.fromRGB(115,115,128)
box.Text = ""
box.TextColor3 = Color3.fromRGB(245,245,248)
box.ClearTextOnFocus = false
box.Font = Enum.Font.Code
box.TextSize = 15
box.Parent = main

local bc = Instance.new("UICorner")
bc.CornerRadius = UDim.new(0,7)
bc.Parent = box

local check = Instance.new("TextButton")
check.Size = UDim2.new(1,-28,0,42)
check.Position = UDim2.fromOffset(14,138)
check.BackgroundColor3 = Color3.fromRGB(112,80,235)
check.BorderSizePixel = 0
check.Text = "CHECK KEY"
check.TextColor3 = Color3.new(1,1,1)
check.Font = Enum.Font.GothamBold
check.TextSize = 14
check.Parent = main

local cc = Instance.new("UICorner")
cc.CornerRadius = UDim.new(0,7)
cc.Parent = check

local status = Instance.new("TextLabel")
status.Size = UDim2.new(1,-28,0,28)
status.Position = UDim2.fromOffset(14,188)
status.BackgroundTransparency = 1
status.Text = "Enter your key to continue."
status.TextColor3 = Color3.fromRGB(178,178,188)
status.TextXAlignment = Enum.TextXAlignment.Left
status.Font = Enum.Font.Gotham
status.TextSize = 12
status.Parent = main

pcall(function()
    if isfile and readfile and isfile(KEY_FILE) then
        box.Text = tostring(readfile(KEY_FILE) or "")
    end
end)

local busy = false

local function setStatus(text,color)
    status.Text = tostring(text)
    if color then status.TextColor3 = color end
end

local function validateKey(rawKey)
    local body = game:HttpGet(KEY_DB_URL, true)
    local db = HttpService:JSONDecode(body)
    local wanted = sha256(rawKey)

    for _,rec in ipairs(db.keys or {}) do
        if tostring(rec.hash or ""):lower() == wanted then
            if rec.revoked == true then
                return false, "This key has been revoked."
            end

            local expires = tonumber(rec.expires) or 0
            if expires > 0 and os.time() > expires then
                return false, "This key has expired."
            end

            return true, tostring(rec.plan or "VALID")
        end
    end

    return false, "Invalid key."
end

local function launch()
    if busy then return end
    busy = true
    check.Active = false
    check.AutoButtonColor = false
    setStatus("Checking key...",Color3.fromRGB(235,190,73))

    local key = tostring(box.Text or ""):gsub("^%s+",""):gsub("%s+$","")
    if key == "" then
        setStatus("Enter a key first.",Color3.fromRGB(235,95,95))
        busy = false
        check.Active = true
        check.AutoButtonColor = true
        return
    end

    local ok,valid,info = pcall(function()
        local pass,message = validateKey(key)
        return pass,message
    end)

    if not ok then
        setStatus("Could not reach key server.",Color3.fromRGB(235,95,95))
        busy = false
        check.Active = true
        check.AutoButtonColor = true
        return
    end

    if not valid then
        setStatus(info,Color3.fromRGB(235,95,95))
        busy = false
        check.Active = true
        check.AutoButtonColor = true
        return
    end

    pcall(function()
        if writefile then
            writefile(KEY_FILE,key)
        end
    end)

    setStatus("Key accepted ["..tostring(info).."] | loading...",Color3.fromRGB(83,209,111))

    local loaded,err = pcall(function()
        local source = game:HttpGet(PAYLOAD_URL,true)
        local fn = loadstring(source)
        if not fn then
            error("loadstring failed")
        end
        sg:Destroy()
        fn()
    end)

    if not loaded then
        setStatus("Payload load failed: "..tostring(err),Color3.fromRGB(235,95,95))
        busy = false
        check.Active = true
        check.AutoButtonColor = true
    end
end

check.MouseButton1Click:Connect(launch)
box.FocusLost:Connect(function(enterPressed)
    if enterPressed then
        launch()
    end
end)
