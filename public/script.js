let userEmail = "";

// GOOGLE LOGIN

async function handleCredentialResponse(response) {

    const message = document.getElementById("auth-message");

    message.innerText = "Sending OTP...";

    try {

        const result = await fetch("/api/send-otp", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                credential: response.credential
            })

        });

        const data = await result.json();

        if (!result.ok || !data.success) {
            throw new Error(data.message || "OTP sending failed");
        }

        userEmail = data.email;

        document.getElementById("otp-section").style.display = "block";

        document.getElementById("otp-email").innerText =
            "OTP sent to " + userEmail;

        message.innerText = "Please check your Gmail inbox.";

    }

    catch (error) {

        console.error(error);

        message.innerText = error.message;

    }

}


// VERIFY OTP

async function verifyOTP() {

    const otp = document.getElementById("otp-input").value;

    const message = document.getElementById("auth-message");

    if (!/^\d{6}$/.test(otp)) {

        message.innerText = "Enter a valid 6-digit OTP.";

        return;

    }

    message.innerText = "Verifying OTP...";

    try {

        const result = await fetch("/api/verify-otp", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                email: userEmail,

                otp: otp

            })

        });

        const data = await result.json();

        if (!result.ok || !data.success) {
            throw new Error(data.message || "Verification failed");
        }

        document.getElementById("auth-container").style.display = "none";

        document.getElementById("portfolio-content").style.display = "block";

        message.innerText = "";

        window.scrollTo(0, 0);

        initializePortfolioEffects();

    }

    catch (error) {

        message.innerText = error.message;

    }

}


// LOGOUT

async function logout() {

    try {

        await fetch("/api/logout", {
            method: "POST"
        });

        window.location.reload();

    }

    catch (error) {

        console.error(error);

    }

}


// ORIGINAL PORTFOLIO EFFECTS

function initializePortfolioEffects() {

    // Smooth scrolling

    document.querySelectorAll("nav a").forEach(link => {

        link.addEventListener("click", function(event) {

            const href = this.getAttribute("href");

            if (href && href.startsWith("#")) {

                event.preventDefault();

                const target = document.querySelector(href);

                if (target) {

                    target.scrollIntoView({
                        behavior: "smooth"
                    });

                }

            }

        });

    });


    // Fade-in animations

    const sections = document.querySelectorAll("#portfolio-content section");

    const observer = new IntersectionObserver(entries => {

        entries.forEach(entry => {

            if (entry.isIntersecting) {

                entry.target.style.opacity = "1";

                entry.target.style.transform = "translateY(0)";

            }

        });

    }, {
        threshold: 0.2
    });


    sections.forEach(section => {

        section.style.opacity = "0";

        section.style.transform = "translateY(40px)";

        section.style.transition = "all 0.8s ease";

        observer.observe(section);

    });


    // Footer year

    const footer = document.querySelector("footer p");

    if (footer) {

        footer.innerHTML =
            `© ${new Date().getFullYear()} Sreelekha Anandam | All Rights Reserved.`;

    }

}