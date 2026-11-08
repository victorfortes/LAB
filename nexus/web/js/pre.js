/* Roda antes do primeiro desenho: escolhe o modo leve. Arquivo próprio para o CSP não precisar de inline. */
try{var e=JSON.parse(localStorage.getItem("nga.efeitos"));var cel=matchMedia("(pointer:coarse)").matches||innerWidth<900;if(e==="leve"||(!e&&cel))document.documentElement.classList.add("leve")}catch(x){}
