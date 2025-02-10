/// <reference types="@types/node" />
import { MarkdownView, PluginManifest, TextFileView, Notice, Platform, App, Plugin } from 'obsidian';
import { Path } from './path';
import { ExportLog } from '../html-generation/render-log';
import { Downloadable } from './downloadable';
import { Settings, SettingsPage } from '../settings/settings';
import HTMLExportPlugin from '../main';

declare module 'obsidian' {
	interface App {
		plugins: {
			enabledPlugins: Set<string>;
			manifests: { [key: string]: PluginManifest };
		};
	}
}

export class Utils
{
	static async delay (ms: number)
	{
		return new Promise( resolve => setTimeout(resolve, ms) );
	}

	static padStringBeggining(str: string, length: number, char: string)
	{
		return char.repeat(length - str.length) + str;
	}

	static includesAny(str: string, substrings: string[]): boolean
	{
		for (let substring of substrings)
		{
			if (str.includes(substring)) return true;
		}

		return false;
	}

	static async urlAvailable(url: RequestInfo | URL) 
	{
		const controller = new AbortController();
		const id = setTimeout(() => controller.abort(), 4000);
		
		const response = await fetch(url, {signal: controller.signal, mode: "no-cors"});
		clearTimeout(id);
	  
		return response;
	}

	static sampleCSSColorHex(variable: string, testParentEl: HTMLElement): { a: number, hex: string }
	{
		let testEl = document.createElement('div');
		testEl.style.setProperty('display', 'none');
		testEl.style.setProperty('color', 'var(' + variable + ')');
		testParentEl.appendChild(testEl);

		let col = getComputedStyle(testEl).color;
		let opacity = getComputedStyle(testEl).opacity;

		testEl.remove();

		function toColorObject(str: string)
		{
			var match = str.match(/rgb?\((\d+),\s*(\d+),\s*(\d+)\)/);
			return match ? {
				red: parseInt(match[1]),
				green: parseInt(match[2]),
				blue: parseInt(match[3]),
				alpha: 1
			} : null
		}

		var color = toColorObject(col), alpha = parseFloat(opacity);
		return isNaN(alpha) && (alpha = 1),
		color ? {
			a: alpha * color.alpha,
			hex: Utils.padStringBeggining(color.red.toString(16), 2, "0") + Utils.padStringBeggining(color.green.toString(16), 2, "0") + Utils.padStringBeggining(color.blue.toString(16), 2, "0")
		} : {
			a: alpha,
			hex: "ffffff"
		}
	};

	static async changeViewMode(view: MarkdownView, modeName: "preview" | "source")
	{
		/*@ts-ignore*/
		const mode = view.modes[modeName]; 
		/*@ts-ignore*/
		mode && await view.setMode(mode);
	};

	static async showSaveDialog(defaultPath: Path, defaultFileName: string, showAllFilesOption: boolean = true): Promise<Path | undefined>
	{
		if (Platform.isDesktopApp) {
			// Desktop implementation using Electron
			/* @ts-ignore */
			const dialog = require('electron').remote.dialog;
			
			let absoluteDefaultPath = defaultPath.directory.absolute().joinString(defaultFileName);
			let filters = [{
				name: Utils.trimStart(absoluteDefaultPath.extension, ".").toUpperCase() + " Files",
				extensions: [Utils.trimStart(absoluteDefaultPath.extension, ".")]
			}];

			if (showAllFilesOption) {
				filters.push({
					name: "All Files",
					extensions: ["*"]
				});
			}

			let result = await dialog.showSaveDialog({
				defaultPath: absoluteDefaultPath.asString,
				filters: filters
			});

			if (!result.canceled && result.filePath) {
				return new Path(result.filePath);
			}
		} else {
			// Mobile implementation using Obsidian's file system
			// On mobile, we'll use the default export path since we can't show a native file picker
			let exportPath = defaultPath.directory.joinString(defaultFileName);
			new Notice(`Exporting to ${exportPath.asString}`);
			return exportPath;
		}
		
		return undefined;
	}

	static async showSelectFolderDialog(defaultPath: Path): Promise<Path | undefined>
	{
		if (Platform.isDesktopApp) {
			// Desktop implementation using Electron
			/* @ts-ignore */
			const dialog = require('electron').remote.dialog;
			
			let result = await dialog.showOpenDialog({
				defaultPath: defaultPath.asString,
				properties: ['openDirectory']
			});

			if (!result.canceled && result.filePaths.length > 0) {
				return new Path(result.filePaths[0]);
			}
		} else {
			// Mobile implementation
			// On mobile, we'll use the default path since we can't show a native folder picker
			new Notice(`Using default folder: ${defaultPath.asString}`);
			return defaultPath;
		}

		return undefined;
	}

	static async showSelectFileDialog(defaultPath: Path): Promise<Path | undefined>
	{
		if (Platform.isDesktopApp) {
			// Desktop implementation using Electron
			/* @ts-ignore */
			const dialog = require('electron').remote.dialog;
			
			let result = await dialog.showOpenDialog({
				defaultPath: defaultPath.asString,
				properties: ['openFile']
			});

			if (!result.canceled && result.filePaths.length > 0) {
				return new Path(result.filePaths[0]);
			}
		} else {
			// Mobile implementation
			// On mobile, we'll use the default path since we can't show a native file picker
			new Notice(`Using default file: ${defaultPath.asString}`);
			return defaultPath;
		}

		return undefined;
	}

	static idealDefaultPath() : Path
	{
		let lastPath = new Path(Settings.exportPath);

		if (lastPath.asString != "" && lastPath.exists)
		{
			return lastPath.directory;
		}

		return Path.vaultPath;
	}

	static async downloadFiles(files: Downloadable[], rootPath: Path)
	{
		for (let i = 0; i < files.length; i++)
		{
			let file = files[i];
			ExportLog.progress(i, files.length, "Downloading Files", "Downloading: " + file.relativePath.asString);
			
			try {
				const plugin = HTMLExportPlugin.plugin as Plugin;
				// Create the directory if it doesn't exist
				const dirPath = rootPath.joinString(file.relativeDirectory.asString).asString;
				await plugin.app.vault.adapter.mkdir(dirPath);
				
				// Write the file using Obsidian's adapter
				const filePath = rootPath.joinString(file.relativePath.asString).asString;
				await plugin.app.vault.adapter.write(
					filePath,
					typeof file.content === 'string' ? file.content : file.content.toString(file.encoding)
				);
			} catch (error) {
				ExportLog.error(`Failed to write file ${file.relativePath.asString}: ${error}`);
				new Notice(`Failed to write file ${file.relativePath.asString}`);
			}
		}
	}

	//async function that awaits until a condition is met
	static async waitUntil(condition: () => boolean, timeout: number = 1000, interval: number = 100): Promise<boolean>
	{
		if (condition()) return true;
		
		return new Promise((resolve, reject) => {
			let timer = 0;
			let intervalId = setInterval(() => {
				if (condition()) {
					clearInterval(intervalId);
					resolve(true);
				} else {
					timer += interval;
					if (timer >= timeout) {
						clearInterval(intervalId);
						resolve(false);
					}
				}
			}, interval);
		});
	}

	static getPluginIDs(): string[]
	{
		const plugins = app.plugins;
		let pluginsArray: string[] = Array.from(plugins.enabledPlugins);
		return pluginsArray.filter(id => plugins.manifests[id] !== undefined);
	}

	static getPluginManifest(pluginID: string): PluginManifest | null
	{
		return app.plugins.manifests[pluginID] ?? null;
	}

	static getActiveTextView(): TextFileView | null
	{
		return app.workspace.getActiveViewOfType(TextFileView);
	}

	static trimEnd(inputString: string, trimString: string): string
	{
		if (inputString.endsWith(trimString))
		{
			return inputString.substring(0, inputString.length - trimString.length);
		}

		return inputString;
	}

	static trimStart(inputString: string, trimString: string): string
	{
		if (inputString.startsWith(trimString))
		{
			return inputString.substring(trimString.length);
		}

		return inputString;
	}

	static async openPath(path: Path)
	{
		if (Platform.isDesktopApp) {
			/* @ts-ignore */
			require('electron').shell.openPath(path.asString);
		} else {
			new Notice(`File exported to ${path.asString}`);
		}
	}

	static levenshteinDistance(string1: string, string2: string): number
	{
		if (!string1.length) return string2.length;
		if (!string2.length) return string1.length;
		const arr = [];
		for (let i = 0; i <= string2.length; i++) {
		  arr[i] = [i];
		  for (let j = 1; j <= string1.length; j++) {
			arr[i][j] =
			  i === 0
				? j
				: Math.min(
					arr[i - 1][j] + 1,
					arr[i][j - 1] + 1,
					arr[i - 1][j - 1] + (string1[j - 1] === string2[i - 1] ? 0 : 1)
				  );
		  }
		}
		return arr[string2.length][string1.length];
	  };
}
