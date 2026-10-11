KeepZotero_Preferences = {
	init: function () {
		Zotero.debug("Initial KeepZotero Preference!");
		const checkbox = document.getElementById('id-keepzotero-cb_start_with_windows');
		if (checkbox) checkbox.disabled = !Zotero.isWin;
	}
};
