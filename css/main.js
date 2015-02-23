(function () {
	var showMenu = document.getElementById('showMenu');
	var menu = document.getElementById('tableOfContents');
	var isOpen = true;

	function open(event) {
		if (!event.pointerType || event.pointerType === 'touch') {
			event.preventDefault();
		}

		isOpen = !isOpen;
		menu.classList.toggle('open', isOpen);
		showMenu.setAttribute('aria-expanded', String(isOpen));
	}

	function close(event) {
		if (isOpen && !menu.contains(event.target) && !showMenu.contains(event.target)) {
			event.preventDefault();
			closeMenu();
		}
	}

	function closeMenu() {
		isOpen = false;
		menu.classList.remove('open');
		showMenu.setAttribute('aria-expanded', 'false');
	}

	if (window.PointerEvent) {
		showMenu.addEventListener('pointerdown', open, false);
		document.addEventListener('pointerdown', close, false);
	}
	else {
		showMenu.addEventListener('touchstart', open, false);
		showMenu.addEventListener('click', open, false);
		document.addEventListener('touchstart', close, false);
		document.addEventListener('mousedown', close, false);
	}

	closeMenu();
})();
