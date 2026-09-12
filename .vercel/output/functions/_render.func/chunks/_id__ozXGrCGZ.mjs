import { r as __exportAll } from "./rolldown-runtime_BMI-E3GI.mjs";
import { C as createAstro, a as Fragment, c as renderSlot, d as renderTemplate, f as maybeRenderHead, h as createRenderInstruction, i as renderComponent, m as addAttribute, p as renderHead } from "./server_D1bUU8TT.mjs";
import { t as createComponent } from "./compiler_O0u1tWSM.mjs";
//#region node_modules/.pnpm/astro@7.2.10_@emnapi+core@1_57ed9b3a55d33fb72b179382db03b1c3/node_modules/astro/dist/runtime/server/render/script.js
async function renderScript(result, id) {
	const inlined = result.inlinedScripts.get(id);
	let content = "";
	if (inlined != null) {
		if (inlined) content = `<script type="module">${inlined}<\/script>`;
	} else {
		const resolved = await result.resolve(id);
		content = `<script type="module" src="${result.userAssetsBase ? (result.base === "/" ? "" : result.base) + result.userAssetsBase : ""}${resolved}"><\/script>`;
	}
	return createRenderInstruction({
		type: "script",
		id,
		content
	});
}
//#endregion
//#region src/layouts/BaseLayout.astro
createAstro("https://astro.build");
var $$BaseLayout = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$BaseLayout;
	const { title = "Original Sneakers Admin", description = "Panel interno de gestión de Original Sneakers." } = Astro.props;
	return renderTemplate`<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><meta name="generator"${addAttribute(Astro.generator, "content")}><meta name="description"${addAttribute(description, "content")}><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="icon" href="/favicon.ico"><title>${title}</title>${renderHead($$result)}</head><body class="min-h-screen overflow-x-hidden bg-slate-950 text-slate-100 antialiased">${renderSlot($$result, $$slots["default"])}</body></html>`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/layouts/BaseLayout.astro", void 0);
//#endregion
//#region src/components/ui/Icon.astro
createAstro("https://astro.build");
var $$Icon = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Icon;
	const { name, class: className = "size-5" } = Astro.props;
	return renderTemplate`${maybeRenderHead($$result)}<svg${addAttribute(className, "class")} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path${addAttribute({
		archive: "M3 6h18M5 6v14h14V6M9 10h6",
		"arrow-left": "m15 18-6-6 6-6",
		box: "m21 8-9 5-9-5m18 0-9-5-9 5m18 0v8l-9 5-9-5V8m9 5v8",
		check: "m5 12 4 4L19 6",
		"chevron-down": "m6 9 6 6 6-6",
		clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14v5l3 2",
		close: "M6 6l12 12M18 6 6 18",
		content: "M4 4h16v16H4zM8 8h8M8 12h8M8 16h5",
		download: "M12 3v12m-5-5 5 5 5-5M5 21h14",
		edit: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4",
		error: "M12 9v4m0 4h.01M10.3 3.6 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z",
		eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
		file: "M6 2h8l4 4v16H6zM14 2v5h5M9 13h6M9 17h6",
		filter: "M4 5h16M7 12h10m-7 7h4",
		image: "M4 4h16v16H4zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12 6-5-5L6 20",
		import: "M12 3v12m-4-4 4 4 4-4M4 21h16",
		menu: "M4 6h16M4 12h16M4 18h16",
		mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3M8 22h8",
		more: "M5 12h.01M12 12h.01M19 12h.01",
		plus: "M12 5v14M5 12h14",
		refresh: "M20 7h-5V2M4 17h5v5M5.5 9a7 7 0 0 1 11.8-3L20 7M4 17l2.7 1A7 7 0 0 0 18.5 15",
		search: "m21 21-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
		settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5 2-1-2-3-2 .5-1.5-1L16 5l-4-1-1 2-2 .5L7 5 4 7l1 2-1 2-2 1 1 4 2 .3 1 2L5 20l4 2 1.5-1.5 2 .2L14 22l4-2-.5-2 1.5-1.5 2 .5 1-4-2-1Z",
		shopify: "M6 8h12l1 13H5L6 8Zm3 0c0-3 1-5 3-5s3 2 3 5",
		sparkles: "m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3L12 3ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Zm14-1 1 2.8L23 17l-3 1.2L19 21l-1-2.8L15 17l3-1.2 1-2.8Z",
		stock: "M4 7h16v13H4zM8 7V4h8v3M8 12h8",
		upload: "M12 16V4m-5 5 5-5 5 5M4 20h16",
		warning: "M12 9v4m0 4h.01M10.3 3.6 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"
	}[name], "d")}></path></svg>`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/components/ui/Icon.astro", void 0);
//#endregion
//#region src/components/layout/AppSidebar.astro
createAstro("https://astro.build");
var $$AppSidebar = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$AppSidebar;
	const { currentPath } = Astro.props;
	const links = [
		{
			href: "/stock",
			label: "Stock",
			icon: "stock"
		},
		{
			href: "/anadir",
			label: "Añadir producto",
			icon: "plus"
		},
		{
			href: "/contenido",
			label: "Contenido",
			icon: "content"
		}
	];
	const active = (href) => currentPath.startsWith(href);
	return renderTemplate`${maybeRenderHead($$result)}<aside class="flex h-full w-60 flex-col border-r border-slate-200 bg-[#f2f3f4] px-4 py-6"><a href="/stock" class="flex h-11 items-center gap-3 rounded-xl px-2 focus-visible:outline-2 focus-visible:outline-blue-600"><span class="grid size-9 place-items-center rounded-xl bg-slate-950 text-xs font-bold text-white">OS</span><span><span class="block text-sm font-semibold tracking-tight">Original Sneakers</span><span class="block text-xs text-slate-500">Herramienta interna</span></span></a><nav class="mt-9 flex-1" aria-label="Navegación principal"><ul class="space-y-1.5">${links.map((link) => renderTemplate`<li><a${addAttribute(link.href, "href")}${addAttribute(active(link.href) ? "page" : void 0, "aria-current")}${addAttribute(["flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600", active(link.href) ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-slate-200/80 hover:text-slate-950"], "class:list")}>${renderComponent($$result, "Icon", $$Icon, {
		"name": link.icon,
		"class": "size-[18px]"
	})}${link.label}</a></li>`)}</ul></nav><div class="border-t border-slate-200 pt-4"><p class="px-3 text-xs leading-5 text-slate-400">Datos de muestra<br>Sin conexiones activas</p></div></aside>`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/components/layout/AppSidebar.astro", void 0);
//#endregion
//#region src/components/layout/MobileNav.astro
createAstro("https://astro.build");
var $$MobileNav = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$MobileNav;
	const { currentPath } = Astro.props;
	return renderTemplate`${maybeRenderHead($$result)}<nav class="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-4 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-1.5 lg:hidden" aria-label="Navegación móvil"><ul class="mx-auto grid max-w-sm grid-cols-3">${[
		{
			href: "/stock",
			label: "Stock",
			icon: "stock"
		},
		{
			href: "/anadir",
			label: "Añadir",
			icon: "plus",
			featured: true
		},
		{
			href: "/contenido",
			label: "Contenido",
			icon: "content"
		}
	].map((link) => {
		const isActive = currentPath.startsWith(link.href);
		return renderTemplate`<li><a${addAttribute(link.href, "href")}${addAttribute(isActive ? "page" : void 0, "aria-current")}${addAttribute(["flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold", link.featured ? "text-slate-950" : isActive ? "text-slate-950" : "text-slate-400"], "class:list")}><span${addAttribute(["grid size-7 place-items-center rounded-lg", link.featured ? "bg-slate-950 text-white" : ""], "class:list")}>${renderComponent($$result, "Icon", $$Icon, {
			"name": link.icon,
			"class": "size-[18px]"
		})}</span><span>${link.label}</span></a></li>`;
	})}</ul></nav>`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/components/layout/MobileNav.astro", void 0);
//#endregion
//#region src/layouts/AdminLayout.astro
createAstro("https://astro.build");
var $$AdminLayout = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$AdminLayout;
	const { title, description } = Astro.props;
	const currentPath = Astro.url.pathname;
	return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, {
		"title": `${title} · Original Sneakers`,
		"description": description
	}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<div class="min-h-screen bg-canvas text-slate-950"><div class="fixed inset-y-0 left-0 z-30 hidden lg:block">${renderComponent($$result, "AppSidebar", $$AppSidebar, { "currentPath": currentPath })}</div><header class="sticky top-0 z-20 flex h-15 items-center border-b border-slate-200 bg-white px-4 lg:hidden"><a href="/stock" class="flex min-h-11 items-center gap-2 rounded-xl font-semibold focus-visible:outline-2 focus-visible:outline-blue-600"><span class="grid size-8 place-items-center rounded-lg bg-slate-950 text-[11px] font-bold text-white">OS</span><span class="text-sm">Original Sneakers</span></a><span class="ml-auto rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">Vista demo</span></header><main class="min-h-screen pb-24 lg:ml-60 lg:pb-10"><div class="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8 lg:py-9 xl:px-10">${renderSlot($$result, $$slots["default"])}</div></main>${renderComponent($$result, "MobileNav", $$MobileNav, { "currentPath": currentPath })}</div>` })}`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/layouts/AdminLayout.astro", void 0);
//#endregion
//#region src/components/ui/ActionMenu.astro
createAstro("https://astro.build");
var $$ActionMenu = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$ActionMenu;
	const { label = "Abrir acciones" } = Astro.props;
	return renderTemplate`${maybeRenderHead($$result)}<details class="relative" data-action-menu><summary class="grid size-11 cursor-pointer list-none place-items-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"${addAttribute(label, "aria-label")}>${renderComponent($$result, "Icon", $$Icon, { "name": "more" })}</summary><div class="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-xl shadow-slate-950/10">${renderSlot($$result, $$slots["default"])}</div></details>`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/components/ui/ActionMenu.astro", void 0);
//#endregion
//#region src/components/ui/Button.astro
createAstro("https://astro.build");
var $$Button = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Button;
	const { href, variant = "secondary", icon, type = "button", disabled = false, class: className, dataDialogOpen } = Astro.props;
	const classes = [
		"inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-45",
		{
			primary: "bg-slate-950 text-white hover:bg-slate-800 shadow-sm",
			secondary: "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 shadow-sm",
			ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
			danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-sm"
		}[variant],
		className
	];
	return renderTemplate`${href ? renderTemplate`${maybeRenderHead($$result)}<a${addAttribute(href, "href")}${addAttribute(classes, "class:list")}${addAttribute(disabled ? "true" : void 0, "aria-disabled")}>${icon && renderTemplate`${renderComponent($$result, "Icon", $$Icon, {
		"name": icon,
		"class": "size-[18px]"
	})}`}${renderSlot($$result, $$slots["default"])}</a>` : renderTemplate`<button${addAttribute(type, "type")}${addAttribute(disabled, "disabled")}${addAttribute(classes, "class:list")}${addAttribute(dataDialogOpen, "data-dialog-open")}>${icon && renderTemplate`${renderComponent($$result, "Icon", $$Icon, {
		"name": icon,
		"class": "size-[18px]"
	})}`}${renderSlot($$result, $$slots["default"])}</button>`}`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/components/ui/Button.astro", void 0);
//#endregion
//#region src/components/ui/FormField.astro
createAstro("https://astro.build");
var $$FormField = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$FormField;
	const { label, name, value, placeholder, required = false, type = "text", hint } = Astro.props;
	return renderTemplate`${maybeRenderHead($$result)}<label class="block min-w-0"><span class="mb-1.5 block text-sm font-medium text-slate-700">${label}${required && renderTemplate`<span class="text-rose-600"> *</span>`}</span><input${addAttribute(type, "type")}${addAttribute(name, "name")}${addAttribute(value, "value")}${addAttribute(placeholder, "placeholder")}${addAttribute(required, "required")} class="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">${hint && renderTemplate`<span class="mt-1.5 block text-xs text-slate-500">${hint}</span>`}</label>`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/components/ui/FormField.astro", void 0);
//#endregion
//#region src/components/ui/Modal.astro
createAstro("https://astro.build");
var $$Modal = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Modal;
	const { id, title, description } = Astro.props;
	return renderTemplate`${maybeRenderHead($$result)}<dialog${addAttribute(id, "id")} class="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/40 open:animate-none"><form method="dialog" class="p-5 sm:p-6"><h2 class="text-lg font-semibold">${title}</h2>${description && renderTemplate`<p class="mt-2 text-sm leading-6 text-slate-500">${description}</p>`}<div class="mt-6">${renderSlot($$result, $$slots["default"])}</div></form></dialog>${renderScript($$result, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/components/ui/Modal.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/components/ui/Modal.astro", void 0);
//#endregion
//#region src/components/ui/PageHeader.astro
createAstro("https://astro.build");
var $$PageHeader = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$PageHeader;
	const { title, description, eyebrow, backHref, backLabel = "Volver" } = Astro.props;
	return renderTemplate`${maybeRenderHead($$result)}<header class="mb-7 lg:mb-9">${backHref && renderTemplate`<a${addAttribute(backHref, "href")} class="mb-4 inline-flex min-h-11 items-center text-sm font-medium text-slate-500 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">← ${backLabel}</a>`}<div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div class="min-w-0">${eyebrow && renderTemplate`<p class="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">${eyebrow}</p>`}<h1 class="text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-3xl">${title}</h1>${description && renderTemplate`<p class="mt-2 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">${description}</p>`}</div><div class="flex shrink-0 flex-wrap items-center gap-2">${renderSlot($$result, $$slots["actions"])}</div></div></header>`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/components/ui/PageHeader.astro", void 0);
//#endregion
//#region src/components/ui/ProductThumbnail.astro
createAstro("https://astro.build");
var $$ProductThumbnail = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$ProductThumbnail;
	const { tone = "stone", size = "md" } = Astro.props;
	return renderTemplate`${maybeRenderHead($$result)}<div${addAttribute([
		"grid shrink-0 place-items-center overflow-hidden",
		{
			stone: "bg-stone-100 text-stone-500",
			blue: "bg-blue-50 text-blue-500",
			amber: "bg-amber-50 text-amber-600",
			rose: "bg-rose-50 text-rose-500",
			green: "bg-emerald-50 text-emerald-600",
			violet: "bg-violet-50 text-violet-500"
		}[tone],
		{
			sm: "size-12 rounded-xl",
			md: "size-14 rounded-xl",
			lg: "aspect-square w-full rounded-2xl"
		}[size]
	], "class:list")} role="img" aria-label="Imagen de producto de muestra"><svg${addAttribute([size === "lg" ? "w-3/4" : "w-10"], "class:list")} viewBox="0 0 120 72" fill="none" aria-hidden="true"><path d="M18 43c12 0 20-6 29-20l14 8c7 4 13 7 22 9l19 4c5 1 8 5 8 10 0 6-5 10-11 10H24C13 64 8 58 10 51c1-5 3-8 8-8Z" fill="currentColor" opacity=".2"></path><path d="M15 50c17 7 59 5 94 2M44 27l8 13m2-9 8 12m2-8 8 10M26 43c10 4 18 5 28 4" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path></svg></div>`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/components/ui/ProductThumbnail.astro", void 0);
//#endregion
//#region src/components/ui/StatusBadge.astro
createAstro("https://astro.build");
var $$StatusBadge = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$StatusBadge;
	const { status, compact = false } = Astro.props;
	const normalized = status.toLowerCase();
	const tone = normalized.includes("no publicado") ? "neutral" : [
		"disponible",
		"publicado",
		"confirmado",
		"correcta"
	].some((value) => normalized.includes(value)) ? "success" : [
		"sin stock",
		"de baja",
		"eliminar"
	].some((value) => normalized.includes(value)) ? "danger" : [
		"revisar",
		"desactualizado",
		"pendiente",
		"repetir"
	].some((value) => normalized.includes(value)) ? "warning" : "neutral";
	return renderTemplate`${maybeRenderHead($$result)}<span${addAttribute([
		"inline-flex max-w-full items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset",
		compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs",
		{
			success: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
			danger: "bg-rose-50 text-rose-700 ring-rose-600/15",
			warning: "bg-amber-50 text-amber-800 ring-amber-600/20",
			neutral: "bg-slate-100 text-slate-600 ring-slate-500/10"
		}[tone]
	], "class:list")}><span${addAttribute(["size-1.5 shrink-0 rounded-full", {
		success: "bg-emerald-500",
		danger: "bg-rose-500",
		warning: "bg-amber-500",
		neutral: "bg-slate-400"
	}[tone]], "class:list")}></span><span class="truncate">${status}</span></span>`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/components/ui/StatusBadge.astro", void 0);
//#endregion
//#region src/lib/mock/data.ts
var mockProducts = [
	{
		id: "nike-air-force-1-retro-prm",
		name: "Nike Air Force 1 Retro PRM",
		brand: "Nike",
		model: "Air Force 1 Retro PRM",
		reference: "IR0871-400",
		colorway: "Hydrogen Blue / Football Grey",
		upc: "198730356907",
		type: "Calzado",
		status: "Disponible",
		sizes: [
			"40",
			"41",
			"42.5"
		],
		stock: 3,
		price: 149.9,
		cost: 79.99,
		tone: "blue",
		imageCount: 4,
		shopifyStatus: "Publicado",
		variants: [
			{
				id: "af1-40",
				size: "40",
				sizeSystem: "EU",
				quantity: 1,
				price: 149.9,
				cost: 79.99,
				barcode: "198730356884"
			},
			{
				id: "af1-41",
				size: "41",
				sizeSystem: "EU",
				quantity: 0,
				price: 149.9,
				cost: 79.99,
				barcode: "198730356891"
			},
			{
				id: "af1-425",
				size: "42.5",
				sizeSystem: "EU",
				quantity: 2,
				price: 149.9,
				cost: 79.99,
				barcode: "198730356907"
			}
		]
	},
	{
		id: "nike-dunk-low-panda",
		name: "Nike Dunk Low Panda",
		brand: "Nike",
		model: "Dunk Low Panda",
		reference: "DD1391-100",
		colorway: "Black / White",
		upc: "194953241014",
		type: "Calzado",
		status: "Disponible",
		sizes: [
			"40",
			"41",
			"42",
			"43",
			"44"
		],
		stock: 7,
		price: 119.9,
		cost: 72,
		tone: "stone",
		imageCount: 6,
		shopifyStatus: "Desactualizado",
		variants: [
			{
				id: "dunk-40",
				size: "40",
				sizeSystem: "EU",
				quantity: 1,
				price: 119.9,
				cost: 72
			},
			{
				id: "dunk-41",
				size: "41",
				sizeSystem: "EU",
				quantity: 2,
				price: 119.9,
				cost: 72
			},
			{
				id: "dunk-42",
				size: "42",
				sizeSystem: "EU",
				quantity: 0,
				price: 119.9,
				cost: 72
			},
			{
				id: "dunk-43",
				size: "43",
				sizeSystem: "EU",
				quantity: 3,
				price: 119.9,
				cost: 72
			},
			{
				id: "dunk-44",
				size: "44",
				sizeSystem: "EU",
				quantity: 1,
				price: 119.9,
				cost: 72
			}
		]
	},
	{
		id: "nike-vomero-5",
		name: "Nike Vomero 5",
		brand: "Nike",
		model: "Vomero 5",
		reference: "FB8825-001",
		colorway: "Photon Dust",
		upc: "196969172649",
		type: "Calzado",
		status: "Revisar",
		sizes: [
			"40",
			"41",
			"42.5",
			"44"
		],
		stock: 5,
		price: 159.9,
		cost: 96,
		tone: "green",
		imageCount: 3,
		shopifyStatus: "No publicado",
		variants: [
			{
				id: "vomero-40",
				size: "40",
				sizeSystem: "EU",
				quantity: 1,
				price: 159.9,
				cost: 96
			},
			{
				id: "vomero-41",
				size: "41",
				sizeSystem: "EU",
				quantity: 1,
				price: 159.9,
				cost: 96
			},
			{
				id: "vomero-425",
				size: "42.5",
				sizeSystem: "EU",
				quantity: 2,
				price: 159.9,
				cost: 96
			},
			{
				id: "vomero-44",
				size: "44",
				sizeSystem: "EU",
				quantity: 1,
				price: 159.9,
				cost: 96
			}
		]
	},
	{
		id: "jordan-1-mid",
		name: "Jordan 1 Mid",
		brand: "Jordan",
		model: "Air Jordan 1 Mid",
		reference: "DQ8426-106",
		colorway: "White / Gym Red",
		upc: "196149835704",
		type: "Calzado",
		status: "Sin stock",
		sizes: [
			"41",
			"42",
			"43",
			"44"
		],
		stock: 0,
		price: 139.9,
		cost: 84,
		tone: "rose",
		imageCount: 5,
		shopifyStatus: "Publicado",
		variants: [{
			id: "jordan-41",
			size: "41",
			sizeSystem: "EU",
			quantity: 0,
			price: 139.9,
			cost: 84
		}, {
			id: "jordan-42",
			size: "42",
			sizeSystem: "EU",
			quantity: 0,
			price: 139.9,
			cost: 84
		}]
	},
	{
		id: "adidas-campus-00s",
		name: "Adidas Campus 00s",
		brand: "Adidas",
		model: "Campus 00s",
		reference: "HQ8708",
		colorway: "Core Black / White",
		upc: "4066749842330",
		type: "Calzado",
		status: "Disponible",
		sizes: [
			"40",
			"40 2/3",
			"42",
			"42 2/3",
			"44"
		],
		stock: 9,
		price: 109.9,
		cost: 64,
		tone: "violet",
		imageCount: 7,
		shopifyStatus: "Publicado",
		variants: [
			{
				id: "campus-40",
				size: "40",
				sizeSystem: "EU",
				quantity: 2,
				price: 109.9,
				cost: 64
			},
			{
				id: "campus-406",
				size: "40 2/3",
				sizeSystem: "EU",
				quantity: 2,
				price: 109.9,
				cost: 64
			},
			{
				id: "campus-42",
				size: "42",
				sizeSystem: "EU",
				quantity: 1,
				price: 109.9,
				cost: 64
			},
			{
				id: "campus-426",
				size: "42 2/3",
				sizeSystem: "EU",
				quantity: 3,
				price: 109.9,
				cost: 64
			},
			{
				id: "campus-44",
				size: "44",
				sizeSystem: "EU",
				quantity: 1,
				price: 109.9,
				cost: 64
			}
		]
	}
];
var formatMoney = (value) => new Intl.NumberFormat("es-ES", {
	style: "currency",
	currency: "EUR"
}).format(value);
//#endregion
//#region src/pages/stock/[id].astro
var _id__exports = /* @__PURE__ */ __exportAll({
	default: () => $$Id,
	file: () => $$file,
	prerender: () => false,
	url: () => $$url
});
createAstro("https://astro.build");
var $$Id = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Id;
	const product = mockProducts.find((item) => item.id === Astro.params.id);
	if (!product) return Astro.redirect("/stock");
	return renderTemplate`${renderComponent($$result, "AdminLayout", $$AdminLayout, {
		"title": product.name,
		"description": `${product.reference} · ${product.brand}`
	}, { "default": ($$result) => renderTemplate`${renderComponent($$result, "PageHeader", $$PageHeader, {
		"title": product.name,
		"description": product.reference,
		"backHref": "/stock",
		"backLabel": "Volver a stock"
	}, { "actions": ($$result) => renderTemplate`${renderComponent($$result, "Fragment", Fragment, { "slot": "actions" }, { "default": ($$result) => renderTemplate`${renderComponent($$result, "Button", $$Button, { "dataDialogOpen": "edit-product" }, { "default": ($$result) => renderTemplate`Editar` })}${renderComponent($$result, "Button", $$Button, { "dataDialogOpen": "adjust-stock" }, { "default": ($$result) => renderTemplate`Ajustar stock` })}${renderComponent($$result, "Button", $$Button, {
		"href": `/contenido?producto=${product.id}&panel=imagenes`,
		"icon": "sparkles"
	}, { "default": ($$result) => renderTemplate`Crear imágenes` })}${renderComponent($$result, "Button", $$Button, {
		"href": `/contenido?producto=${product.id}&canal=shopify`,
		"variant": "primary",
		"icon": "shopify"
	}, { "default": ($$result) => renderTemplate`Shopify` })}${renderComponent($$result, "ActionMenu", $$ActionMenu, {}, { "default": ($$result) => renderTemplate`${maybeRenderHead($$result)}<button type="button" data-dialog-open="archive-product" class="block min-h-11 w-full rounded-lg px-3 text-left font-medium text-rose-700 hover:bg-rose-50">Dar de baja</button>` })}` })}` })}<div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,.8fr)]"><section class="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><div class="grid gap-3 sm:grid-cols-[4.5rem_1fr]"><div class="order-2 flex gap-2 sm:order-1 sm:flex-col">${[
		product.tone,
		"stone",
		"blue"
	].map((tone) => renderTemplate`<button type="button" class="w-16 overflow-hidden rounded-xl ring-1 ring-slate-200 first:ring-2 first:ring-slate-950 sm:w-full" aria-label="Ver imagen">${renderComponent($$result, "ProductThumbnail", $$ProductThumbnail, {
		"tone": tone,
		"size": "lg"
	})}</button>`)}</div><div class="order-1 sm:order-2">${renderComponent($$result, "ProductThumbnail", $$ProductThumbnail, {
		"tone": product.tone,
		"size": "lg"
	})}</div></div><p class="mt-3 text-xs text-slate-400">Imágenes de muestra</p></section><section class="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><div class="flex items-center justify-between"><h2 class="text-lg font-semibold">Producto</h2>${renderComponent($$result, "StatusBadge", $$StatusBadge, { "status": product.status })}</div><dl class="mt-6 grid grid-cols-2 gap-x-5 gap-y-6">${[
		["Marca", product.brand],
		["Modelo", product.model],
		["Referencia", product.reference],
		["Colorway", product.colorway],
		["UPC", product.upc],
		["Tipo", product.type],
		["Precio", formatMoney(product.price)],
		["Coste", formatMoney(product.cost)]
	].map(([label, value]) => renderTemplate`<div><dt class="text-xs font-medium text-slate-400">${label}</dt><dd class="mt-1 text-sm font-semibold">${value}</dd></div>`)}</dl></section></div><section class="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white"><header class="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 class="text-lg font-semibold">Tallas y stock</h2><p class="mt-1 text-sm text-slate-500">${product.stock} pares disponibles</p></div><div class="flex gap-2">${renderComponent($$result, "Button", $$Button, { "icon": "plus" }, { "default": ($$result) => renderTemplate`Añadir talla` })}${renderComponent($$result, "Button", $$Button, {
		"dataDialogOpen": "adjust-stock",
		"variant": "primary"
	}, { "default": ($$result) => renderTemplate`Ajustar stock` })}</div></header><div class="hidden md:block"><table class="w-full text-left text-sm"><thead class="bg-slate-50 text-xs text-slate-500"><tr><th class="px-5 py-3">Talla</th><th class="px-3 py-3">Cantidad</th><th class="px-3 py-3">PVP</th><th class="px-3 py-3">Coste</th><th class="px-3 py-3">Estado</th><th class="px-3 py-3"></th></tr></thead><tbody class="divide-y divide-slate-100">${product.variants.map((variant) => renderTemplate`<tr><td class="px-5 py-4 font-semibold">${variant.size} <span class="text-xs text-slate-400">${variant.sizeSystem}</span></td><td class="px-3 py-4 font-semibold tabular-nums">${variant.quantity}</td><td class="px-3 py-4 tabular-nums">${formatMoney(variant.price)}</td><td class="px-3 py-4 tabular-nums text-slate-500">${formatMoney(variant.cost)}</td><td class="px-3 py-4">${renderComponent($$result, "StatusBadge", $$StatusBadge, {
		"status": variant.quantity > 0 ? "Disponible" : "Sin stock",
		"compact": true
	})}</td><td class="px-3 py-4"><button type="button" data-variant-stock${addAttribute(variant.size, "data-size")}${addAttribute(variant.quantity, "data-quantity")} class="min-h-11 rounded-xl px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100">Ajustar</button></td></tr>`)}</tbody></table></div><div class="divide-y divide-slate-100 md:hidden">${product.variants.map((variant) => renderTemplate`<article class="p-4"><div class="flex items-center justify-between"><p class="text-lg font-semibold">${variant.size} <span class="text-xs text-slate-400">${variant.sizeSystem}</span></p>${renderComponent($$result, "StatusBadge", $$StatusBadge, {
		"status": variant.quantity > 0 ? "Disponible" : "Sin stock",
		"compact": true
	})}</div><dl class="mt-4 grid grid-cols-3 gap-3"><div><dt class="text-xs text-slate-400">Cantidad</dt><dd class="mt-1 text-sm font-semibold">${variant.quantity}</dd></div><div><dt class="text-xs text-slate-400">PVP</dt><dd class="mt-1 text-sm font-semibold">${formatMoney(variant.price)}</dd></div><div><dt class="text-xs text-slate-400">Coste</dt><dd class="mt-1 text-sm font-semibold">${formatMoney(variant.cost)}</dd></div></dl><button type="button" data-variant-stock${addAttribute(variant.size, "data-size")}${addAttribute(variant.quantity, "data-quantity")} class="mt-4 min-h-11 w-full rounded-xl bg-slate-100 text-sm font-semibold">Ajustar stock</button></article>`)}</div></section><section class="mt-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div class="flex items-center gap-2"><h2 class="text-lg font-semibold">Shopify</h2>${renderComponent($$result, "StatusBadge", $$StatusBadge, {
		"status": product.shopifyStatus,
		"compact": true
	})}</div><p class="mt-1 text-sm text-slate-500">La publicación vive dentro de este producto.</p></div><div class="flex flex-wrap gap-2">${product.shopifyStatus !== "Publicado" && renderTemplate`${renderComponent($$result, "Button", $$Button, { "variant": "primary" }, { "default": ($$result) => renderTemplate`Publicar` })}`}${product.shopifyStatus === "Publicado" && renderTemplate`${renderComponent($$result, "Button", $$Button, { "variant": "primary" }, { "default": ($$result) => renderTemplate`Actualizar` })}`}${renderComponent($$result, "Button", $$Button, {}, { "default": ($$result) => renderTemplate`Despublicar` })}</div></div></section>${renderComponent($$result, "Modal", $$Modal, {
		"id": "adjust-stock",
		"title": "Ajustar stock",
		"description": `${product.name} · cambio no persistente`
	}, { "default": ($$result) => renderTemplate`<label class="block"><span class="mb-1.5 block text-sm font-medium">Talla</span><select data-size-select class="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3">${product.variants.map((variant) => renderTemplate`<option${addAttribute(variant.size, "value")}${addAttribute(variant.quantity, "data-quantity")}>${variant.size} ${variant.sizeSystem}</option>`)}</select></label><div class="mt-6"><p class="text-center text-xs font-medium text-slate-500">Cantidad actual</p><div class="mt-3 flex items-center justify-center gap-3"><button type="button" data-minus class="grid size-12 place-items-center rounded-xl border border-slate-200 text-xl">−</button><output data-quantity class="grid size-14 place-items-center rounded-xl bg-slate-100 text-xl font-semibold">${product.variants[0]?.quantity ?? 0}</output><button type="button" data-plus class="grid size-12 place-items-center rounded-xl bg-slate-950 text-xl text-white">+</button></div></div><label class="mt-6 block"><span class="mb-1.5 block text-sm font-medium">Motivo</span><select class="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3"><option>Venta</option><option>Compra</option><option>Ajuste</option><option>Devolución</option></select></label><div class="mt-6 grid grid-cols-2 gap-2"><button type="button" data-dialog-close class="min-h-12 rounded-xl border border-slate-200 font-semibold">Cancelar</button><button type="button" data-dialog-close class="min-h-12 rounded-xl bg-slate-950 font-semibold text-white">Guardar</button></div>` })}${renderComponent($$result, "Modal", $$Modal, {
		"id": "edit-product",
		"title": "Editar producto",
		"description": "Los cambios no se guardarán en esta demo."
	}, { "default": ($$result) => renderTemplate`<div class="grid gap-4 sm:grid-cols-2">${renderComponent($$result, "FormField", $$FormField, {
		"label": "Marca",
		"name": "brand",
		"value": product.brand
	})}${renderComponent($$result, "FormField", $$FormField, {
		"label": "Modelo",
		"name": "model",
		"value": product.model
	})}${renderComponent($$result, "FormField", $$FormField, {
		"label": "Referencia",
		"name": "reference",
		"value": product.reference
	})}${renderComponent($$result, "FormField", $$FormField, {
		"label": "UPC",
		"name": "upc",
		"value": product.upc
	})}</div><div class="mt-6 flex justify-end gap-2"><button type="button" data-dialog-close class="min-h-11 rounded-xl border border-slate-200 px-4 font-semibold">Cancelar</button><button type="button" data-dialog-close class="min-h-11 rounded-xl bg-slate-950 px-4 font-semibold text-white">Guardar</button></div>` })}${renderComponent($$result, "Modal", $$Modal, {
		"id": "archive-product",
		"title": "Dar de baja producto",
		"description": "Este producto dejará de estar activo pero conservará su historial."
	}, { "default": ($$result) => renderTemplate`<div class="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-800">${product.name}</div><div class="mt-6 grid grid-cols-2 gap-2"><button type="button" data-dialog-close class="min-h-12 rounded-xl border border-slate-200 font-semibold">Cancelar</button><button type="button" data-dialog-close class="min-h-12 rounded-xl bg-rose-600 font-semibold text-white">Dar de baja</button></div>` })}${renderScript($$result, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/pages/stock/[id].astro?astro&type=script&index=0&lang.ts")}` })}`;
}, "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/pages/stock/[id].astro", void 0);
var $$file = "C:/Users/marti/Desktop/Altaria Lights/original-sneakers-admin/src/pages/stock/[id].astro";
var $$url = "/stock/[id]";
//#endregion
//#region \0virtual:astro:page:src/pages/stock/[id]@_@astro
var page = () => _id__exports;
//#endregion
export { page };
